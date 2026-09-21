/**
 * The vault catalog: listings and the note index in Postgres, bytes in the vault store
 * (catalog/index.ts). The app and site never touch either directly; this server holds the
 * service role and decides who may read a note body.
 *
 *   GET  /vaults                       list published vaults (category, q, sort, featured, free, limit, ids)
 *   GET  /vaults/:id                   one vault (drafts only for their seller)
 *   GET  /vaults/:id/notes             note metadata (paths, titles, preview flags)
 *   GET  /vaults/:id/notes/*           one note's markdown (preview notes are public, the rest need ownership)
 *   GET  /vaults/:id/search?q=         full-text search inside a vault (owners)
 *   GET  /vaults/:id/access            { owned }
 *   POST /vaults/:id/claim             free vault -> purchases row
 *   GET  /vaults/:id/download-link     { url } short-lived zip link (owners)
 *   GET  /downloads/:token             the zip
 *   GET  /sellers/:userId/vaults       a seller's published vaults
 *   GET  /me/vaults | /me/stats | /me/library
 *   POST /vaults  { input, id? }       create / update a listing (seller)
 *   POST /vaults/:id/status { status } | DELETE /vaults/:id
 *   POST /vaults/:id/refresh-rating    recompute the listing's rating from its reviews (a trigger does it too)
 *   POST /uploads/vault-zip?vaultId=   multipart zip -> scanned, unpacked, note/attachment documents -> { path: bundleId, ... }
 *                                      vaultId is the listing being replaced, so its current
 *                                      size is left out of the seller's storage quota
 *   POST /uploads/vault-zip/init       { mode: 'direct' } or { mode: 'queued', key, url }: where the
 *                                      client should send the zip (see upload-queue.ts)
 *   POST /uploads/vault-zip/complete?vaultId=  { key } -> { jobId }   the zip is in the store; queue it
 *   GET  /uploads/vault-zip/jobs/:id   { state, result? | error? }    poll a queued upload
 *   POST /uploads/cover                multipart image -> vault store -> { url }
 *   GET  /files/covers/:name           a cover image, public, cached for a year (names are uuids)
 *   POST /admin/sellers/:userId/plan   { plan } put a seller on a storage plan (operators)
 */
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import type { CategorySlug, SellerStats, SortMode, VaultInput, VaultStatus } from '../types.ts';
import * as catalog from '../catalog/index.ts';
import { imageKind } from '../catalog/file-policy.ts';
import { ownsVault, requester, requireRequester, sellerProfile } from '../access.ts';
import { requireAdmin } from '../admin.ts';
import { IS_DEMO, cfg, minPriceCents } from '../config.ts';
import { sellerBalance } from '../payout-ledger.ts';
import { hasPayoutDetails } from '../seller-payouts.ts';
import { signDownload, verifyDownload } from '../download.ts';
import { FINGERPRINT_ENABLED, extractMark, traceLeak } from '../fingerprint.ts';
import { isPlanId, planFor, setPlan } from '../plans.ts';
import { UPLOAD_QUEUE_ENABLED, enqueueScan, uploadJobStatus } from '../upload-queue.ts';
import { incomingKey, objectSize, ownsKey, presignUpload, removeObject } from '../upload-store.ts';
import { MAX_ZIP_BYTES, MAX_ZIP_LABEL, UploadRejected, processVaultZip } from '../vault-upload.ts';
import { contentTypeFor, coverKey, streamObject } from '../vault-store.ts';
import { admin } from '../supabase.ts';

const MAX_COVER_BYTES = 5 * 1024 * 1024;

export default async function catalogRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_ZIP_BYTES, files: 1 } });

  app.addHook('onRequest', async (_req, reply) => {
    if (!catalog.CATALOG_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured: it needs Supabase and VAULT_STORE_ENDPOINT on the server.' });
  });

  /* ---------- public reads ---------- */

  app.get<{ Querystring: Record<string, string | undefined> }>('/vaults', async (req) => {
    const q = req.query;
    if (q.ids) return catalog.getVaultsByIds(q.ids.split(',').filter(Boolean).slice(0, 100));
    return catalog.listVaults({
      category: (q.category as CategorySlug) || undefined,
      search: q.q || q.search || undefined,
      sort: (q.sort as SortMode) || undefined,
      featured: q.featured === '1' || q.featured === 'true',
      freeOnly: q.free === '1' || q.free === 'true',
      limit: Math.min(Number(q.limit) || 50, 100),
      cursor: q.cursor || undefined,
    });
  });

  app.get<{ Params: { id: string } }>('/vaults/:id', async (req, reply) => {
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    if (v.status !== 'published') {
      const r = await requester(req);
      if (!r || (v.sellerId !== r.id && !r.demo)) return reply.code(404).send({ error: 'Vault not found' });
    }
    return v;
  });

  app.get<{ Params: { id: string } }>('/vaults/:id/notes', async (req, reply) => {
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    return catalog.listNotes(v.id);
  });

  app.get<{ Params: { id: string; '*': string } }>('/vaults/:id/notes/*', async (req, reply) => {
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    const note = await catalog.getNote(v.id, decodeURIComponent(req.params['*']));
    if (!note) return reply.code(404).send({ error: 'Note not found' });
    if (!note.isPreview && !(await ownsVault(await requester(req), v))) {
      return reply.code(403).send({ error: 'Buy this vault to read its notes.' });
    }
    return note;
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string; limit?: string } }>('/vaults/:id/search', async (req, reply) => {
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    if (!(await ownsVault(await requester(req), v))) return reply.code(403).send({ error: 'Buy this vault to search it.' });
    const q = (req.query.q ?? '').trim();
    if (!q) return [];
    return catalog.searchNotes(v.id, q, Math.min(Number(req.query.limit) || 20, 50));
  });

  app.get<{ Params: { userId: string } }>('/sellers/:userId/vaults', async (req) => catalog.getSellerVaults(req.params.userId));

  app.get<{ Params: { userId: string } }>('/sellers/:userId', async (req, reply) => {
    const s = await catalog.getSeller(req.params.userId);
    if (!s) return reply.code(404).send({ error: 'Seller not found' });
    return s;
  });

  /* ---------- buying ---------- */

  app.get<{ Params: { id: string } }>('/vaults/:id/access', async (req, reply) => {
    const r = await requester(req);
    if (!r) return { owned: false };
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    if (r.demo) return { owned: v.sellerId === r.id, demo: true }; // purchases live in the demo client
    return { owned: await ownsVault(r, v) };
  });

  app.post<{ Params: { id: string } }>('/vaults/:id/claim', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const v = await catalog.getVault(req.params.id);
    if (!v || v.status !== 'published') return reply.code(404).send({ error: 'Vault not found' });
    if (v.priceCents !== 0) return reply.code(400).send({ error: 'This vault is not free' });
    if (r.demo) return { claimed: true, demo: true };
    const { error } = await admin()
      .from('purchases')
      .upsert({ vault_id: v.id, buyer_id: r.id, amount_cents: 0, fee_cents: 0 }, { onConflict: 'vault_id,buyer_id', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return { claimed: true };
  });

  app.get<{ Params: { id: string } }>('/vaults/:id/download-link', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const v = await catalog.getVault(req.params.id);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    if (!(await ownsVault(r, v))) return reply.code(403).send({ error: 'Buy this vault to download it.' });
    // The seller keeps their own download; it is their file. Everyone else installs it through
    // the plugin, so there is no zip sitting in a Downloads folder ready to be reposted.
    if (v.pluginOnly && v.sellerId !== r.id) {
      return reply.code(403).send({ error: 'This vault installs through the Vault Market plugin for Obsidian, so it has no zip download. Open Obsidian and run "Vault Market: install or update a vault".' });
    }
    return { url: `${cfg.apiUrl}/downloads/${signDownload(v.id, r.id)}`, expiresInSeconds: 300 };
  });

  app.get<{ Params: { token: string } }>('/downloads/:token', async (req, reply) => {
    const claim = verifyDownload(req.params.token);
    if (!claim) return reply.code(410).send({ error: 'Download link expired. Open the vault again to get a fresh one.' });
    const v = await catalog.getVault(claim.vaultId);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    // The seller's own archive, straight out of the store: nothing is rebuilt or held in memory.
    const zip = await catalog.openVaultZip(v);
    if (!zip) return reply.code(404).send({ error: 'This listing has no vault file yet.' });
    void catalog.incrementDownloads(v.id);
    const filename = `${v.title.replace(/[^\w\- ]+/g, '').trim() || 'vault'}.zip`;
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(zip.size))
      .send(zip.stream);
  });

  app.get('/me/library', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (r.demo) return [];
    const { data, error } = await admin().from('purchases').select('*').eq('buyer_id', r.id).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const vaults = await catalog.getVaultsByIds((data ?? []).map((p: any) => p.vault_id));
    const byId = new Map(vaults.map((v) => [v.id, v]));
    return (data ?? []).map((p: any) => ({
      id: p.id,
      vaultId: p.vault_id,
      buyerId: p.buyer_id,
      amountCents: p.amount_cents,
      feeCents: p.fee_cents,
      createdAt: p.created_at,
      vault: byId.get(p.vault_id),
    }));
  });

  /* ---------- selling ---------- */

  app.get('/me/vaults', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    return catalog.getSellerVaults(r.id, true);
  });

  app.get('/me/stats', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const [mine, plan] = await Promise.all([catalog.getSellerVaults(r.id, true), planFor(r.id)]);
    const stats: SellerStats = {
      grossCents: 0,
      feeCents: 0,
      netCents: 0,
      salesCount: 0,
      downloads: mine.reduce((s, v) => s + v.downloads, 0),
      publishedCount: mine.filter((v) => v.status === 'published').length,
      storageUsedBytes: mine.reduce((s, v) => s + (v.sizeBytes || 0), 0),
      storageLimitBytes: plan.quotaBytes,
      storagePlan: plan.label,
    };
    if (!r.demo && mine.length) {
      const { data } = await admin()
        .from('purchases')
        .select('amount_cents, fee_cents')
        .in('vault_id', mine.map((v) => v.id));
      for (const p of data ?? []) {
        stats.grossCents += p.amount_cents;
        stats.feeCents += p.fee_cents;
        if (p.amount_cents > 0) stats.salesCount++;
      }
      stats.netCents = stats.grossCents - stats.feeCents;
      // What has actually reached them, which is not the same as what they have earned:
      // the platform transfers it separately, so a sale and its payout are different events.
      const balance = await sellerBalance(r.id);
      stats.paidOutCents = balance.paidCents;
      stats.outstandingCents = balance.outstandingCents;
      stats.payoutThresholdCents = balance.thresholdCents;
      stats.availableCents = balance.availableCents;
      stats.holdingCents = balance.holdingCents;
      stats.payoutCycleDay = balance.cycleDay;
      stats.nextPayoutAt = balance.nextPayoutAt;
    }
    return stats;
  });

  app.post<{ Body: { input: VaultInput; id?: string } }>(
    '/vaults',
    { schema: { body: { type: 'object', required: ['input'], properties: { input: { type: 'object' }, id: { type: 'string' } } } } },
    async (req, reply) => {
      const r = await requireRequester(req, reply);
      if (!r) return;
      const input = req.body.input;
      if (!input.title || input.title.trim().length < 3) return reply.code(400).send({ error: 'Title is too short' });
      // Derived from the commission and the provider's fee, so a price that would cost the
      // platform money on every sale cannot be listed at all.
      const floor = minPriceCents();
      if (input.priceCents !== 0 && input.priceCents < floor) {
        return reply.code(400).send({ error: `Paid vaults start at ₹${Math.round(floor / 100)}. Below that the payment fees cost more than the sale earns. You can list it free instead.` });
      }
      // A paid listing that goes live must belong to a seller we can actually pay. Dodo
      // settles to the platform, so nothing reaches the seller unless we know where to send it.
      if (input.status === 'published' && input.priceCents > 0 && !(await hasPayoutDetails(r.id))) {
        return reply.code(400).send({ error: 'Add your payout details before publishing a paid vault. You can save it as a draft, or publish it free.' });
      }
      const seller = await sellerProfile(r);
      try {
        return await catalog.saveVault({ ...input, priceCents: Math.round(input.priceCents) }, seller, req.body.id);
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not save' });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { status: VaultStatus } }>('/vaults/:id/status', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (!['draft', 'published', 'unlisted'].includes(req.body?.status)) return reply.code(400).send({ error: 'Invalid status' });
    if (req.body.status === 'published') {
      const v = await catalog.getVault(req.params.id);
      if (v && v.priceCents > 0 && !(await hasPayoutDetails(r.id))) {
        return reply.code(400).send({ error: 'Add your payout details before publishing a paid vault. You can publish it free instead.' });
      }
    }
    try {
      await catalog.setVaultStatus(req.params.id, req.body.status, r.id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not update' });
    }
  });

  app.delete<{ Params: { id: string } }>('/vaults/:id', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    try {
      await catalog.deleteVault(req.params.id, r.id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not delete' });
    }
  });

  // A trigger keeps the rating current as reviews land; this recomputes it on request, which
  // the site still asks for after posting a review.
  app.post<{ Params: { id: string } }>('/vaults/:id/refresh-rating', async (req) => {
    if (IS_DEMO) return { ok: true, demo: true };
    const { ratingAvg, ratingCount } = await catalog.refreshRating(req.params.id);
    return { ok: true, ratingAvg, ratingCount };
  });

  app.post<{ Querystring: { vaultId?: string } }>('/uploads/vault-zip', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Attach the .zip as multipart field "file"' });
    const buf = await part.toBuffer();
    if (part.file.truncated) return reply.code(413).send({ error: `Zip is larger than ${MAX_ZIP_LABEL}` });

    // The whole job, inline: scan, unpack, quota, ingest (vault-upload.ts). The worker runs the
    // same function on zips that came through the queue.
    try {
      return await processVaultZip(buf, r.id, req.log, req.query.vaultId);
    } catch (e) {
      if (e instanceof UploadRejected) return reply.code(e.statusCode).send({ error: e.message });
      req.log.error(e);
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });

  /* ---------- queued uploads (upload-queue.ts, upload-store.ts, worker/) ---------- */

  // Answered whether or not the queue is on, so one client works against both kinds of
  // deployment: it asks here first, then either posts the zip to /uploads/vault-zip or PUTs it
  // at the link and reports back. A store that is not answering falls back to the inline
  // path rather than refusing the upload; the scanner still runs either way.
  app.post('/uploads/vault-zip/init', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (!UPLOAD_QUEUE_ENABLED) return { mode: 'direct' };
    const key = incomingKey(r.id);
    try {
      return { mode: 'queued', key, url: await presignUpload(key), maxBytes: MAX_ZIP_BYTES };
    } catch (e) {
      req.log.error(e, 'upload store unavailable, falling back to the inline upload');
      return { mode: 'direct' };
    }
  });

  app.post<{ Body: { key?: unknown }; Querystring: { vaultId?: string } }>('/uploads/vault-zip/complete', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (!UPLOAD_QUEUE_ENABLED) return reply.code(404).send({ error: 'Queued uploads are not enabled here. Post the zip to /uploads/vault-zip.' });
    const key = req.body?.key;
    // Their own prefix only: the key is the one /init handed them, not a path of their choosing.
    if (typeof key !== 'string' || !ownsKey(key, r.id)) return reply.code(400).send({ error: 'Unknown upload key' });
    const size = await objectSize(key);
    if (size === null) return reply.code(400).send({ error: 'The zip never reached the upload store. Try the upload again.' });
    if (size > MAX_ZIP_BYTES) {
      await removeObject(key);
      return reply.code(413).send({ error: `Zip is larger than ${MAX_ZIP_LABEL}` });
    }
    try {
      return { jobId: await enqueueScan({ key, userId: r.id, replacingVaultId: req.query.vaultId || undefined }) };
    } catch (e) {
      req.log.error(e, 'upload queue unavailable');
      return reply.code(503).send({ error: 'The upload queue is not answering, so this upload was not accepted. Try again in a few minutes.' });
    }
  });

  app.get<{ Params: { id: string } }>('/uploads/vault-zip/jobs/:id', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (!UPLOAD_QUEUE_ENABLED) return reply.code(404).send({ error: 'Queued uploads are not enabled here.' });
    const status = await uploadJobStatus(req.params.id, r.id);
    if (!status) return reply.code(404).send({ error: 'Upload not found' });
    return status;
  });

  app.post('/uploads/cover', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Attach the image as multipart field "file"' });
    const buf = await part.toBuffer();
    if (buf.byteLength > MAX_COVER_BYTES) return reply.code(413).send({ error: 'Cover must be under 5 MB' });
    // Judged by its bytes, not the type the browser declared or the name it came with.
    const kind = imageKind(buf);
    if (!kind) return reply.code(400).send({ error: 'Cover must be a PNG, JPEG, WebP or GIF' });
    try {
      return { url: await catalog.uploadCoverImage(buf, `cover.${kind === 'jpeg' ? 'jpg' : kind}`) };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });

  // Covers are public: they are on the storefront. Names are uuids, so the cache can be long.
  app.get<{ Params: { name: string } }>('/files/covers/:name', async (req, reply) => {
    const name = req.params.name;
    if (!/^[\w-]+\.(png|jpe?g|webp|gif)$/i.test(name)) return reply.code(404).send({ error: 'Not found' });
    const obj = await streamObject(coverKey(name));
    if (!obj) return reply.code(404).send({ error: 'Not found' });
    return reply
      .header('Content-Type', contentTypeFor(name))
      .header('Content-Length', String(obj.size))
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(obj.stream);
  });

  /* ---------- operators ---------- */

  // Paste a note out of a leaked vault and learn which account it was served to. The mark is
  // derived, never stored, so this walks that vault's buyers and compares (fingerprint.ts).
  app.post<{ Body: { vaultId?: unknown; text?: unknown } }>('/admin/fingerprint/trace', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { vaultId, text } = req.body ?? {};
    if (typeof vaultId !== 'string' || !vaultId || typeof text !== 'string' || !text) {
      return reply.code(400).send({ error: 'Send { vaultId, text } where text is the leaked note.' });
    }
    if (!FINGERPRINT_ENABLED) return reply.code(501).send({ error: 'Fingerprinting is off: FINGERPRINT_SECRET is not set on this server.' });
    const mark = extractMark(text);
    if (!mark) return { mark: null, buyer: null, note: 'No mark in that text. It was not served by the plugin, or it was stripped.' };
    const { data, error } = await admin().from('purchases').select('buyer_id').eq('vault_id', vaultId);
    if (error) throw new Error(error.message);
    const buyerIds = (data ?? []).map((p: { buyer_id: string }) => p.buyer_id);
    const vault = await catalog.getVault(vaultId);
    const candidates = vault?.sellerId ? [...new Set([...buyerIds, vault.sellerId])] : buyerIds;
    const userId = traceLeak(text, vaultId, candidates);
    if (!userId) return { mark, buyer: null, note: `Mark found but it matches none of the ${candidates.length} accounts holding this vault.` };
    const { data: profile } = await admin().from('profiles').select('username, display_name').eq('id', userId).maybeSingle();
    return { mark, buyer: { userId, username: profile?.username ?? null, displayName: profile?.display_name ?? null, isSeller: userId === vault?.sellerId } };
  });

  app.post<{ Params: { userId: string }; Body: { plan?: unknown; periodEnd?: unknown } }>('/admin/sellers/:userId/plan', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const plan = req.body?.plan;
    if (!isPlanId(plan)) return reply.code(400).send({ error: 'plan must be free, plus or pro' });
    const periodEnd = typeof req.body?.periodEnd === 'string' && !Number.isNaN(Date.parse(req.body.periodEnd)) ? new Date(req.body.periodEnd).toISOString() : null;
    return setPlan(req.params.userId, plan, periodEnd);
  });
}
