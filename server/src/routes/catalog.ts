/**
 * Vault catalog backed by Sanity. The app and site never query Sanity directly;
 * the dataset is private and this server holds the token.
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
 *   POST /vaults/:id/refresh-rating    recompute rating from Supabase reviews into Sanity
 *   POST /uploads/vault-zip            multipart zip -> note/attachment documents -> { path: bundleId, ... }
 *   POST /uploads/cover                multipart image -> Sanity image asset -> { url }
 */
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { unzipSync } from 'fflate';
import type { CategorySlug, SellerStats, SortMode, VaultInput, VaultStatus } from '../types.ts';
import * as catalog from '../sanity/index.ts';
import { ownsVault, requester, requireRequester, sellerProfile } from '../access.ts';
import { IS_DEMO, cfg, minPriceCents, platformFee } from '../config.ts';
import { sellerBalance } from '../payout-ledger.ts';
import { hasPayoutDetails } from '../seller-payouts.ts';
import { buildVaultZip, signDownload, verifyDownload } from '../download.ts';
import { admin } from '../supabase.ts';

const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_COVER_BYTES = 5 * 1024 * 1024;

export default async function catalogRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_ZIP_BYTES, files: 1 } });

  app.addHook('onRequest', async (_req, reply) => {
    if (!catalog.SANITY_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured (SANITY_PROJECT_ID / CATALOG_SOURCE).' });
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
      offset: Math.max(0, Math.floor(Number(q.offset) || 0)),
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
    return { url: `${cfg.apiUrl}/downloads/${signDownload(v.id, r.id)}`, expiresInSeconds: 300 };
  });

  app.get<{ Params: { token: string } }>('/downloads/:token', async (req, reply) => {
    const claim = verifyDownload(req.params.token);
    if (!claim) return reply.code(410).send({ error: 'Download link expired. Open the vault again to get a fresh one.' });
    const v = await catalog.getVault(claim.vaultId);
    if (!v) return reply.code(404).send({ error: 'Vault not found' });
    const zip = await buildVaultZip(v.id, v.title);
    const filename = `${v.title.replace(/[^\w\- ]+/g, '').trim() || 'vault'}.zip`;
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Content-Length', String(zip.byteLength))
      .send(Buffer.from(zip));
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
    const mine = await catalog.getSellerVaults(r.id, true);
    const stats: SellerStats = {
      grossCents: 0,
      feeCents: 0,
      netCents: 0,
      salesCount: 0,
      downloads: mine.reduce((s, v) => s + v.downloads, 0),
      publishedCount: mine.filter((v) => v.status === 'published').length,
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

  app.post<{ Params: { id: string } }>('/vaults/:id/refresh-rating', async (req, reply) => {
    if (IS_DEMO) return { ok: true, demo: true };
    const { data, error } = await admin().from('reviews').select('rating').eq('vault_id', req.params.id);
    if (error) throw new Error(error.message);
    const count = data?.length ?? 0;
    const avg = count ? Math.round(((data ?? []).reduce((s: number, r: any) => s + r.rating, 0) / count) * 100) / 100 : 0;
    await catalog.setRating(req.params.id, avg, count);
    return { ok: true, ratingAvg: avg, ratingCount: count };
  });

  app.post('/uploads/vault-zip', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Attach the .zip as multipart field "file"' });
    const buf = await part.toBuffer();
    if (part.file.truncated) return reply.code(413).send({ error: 'Zip is larger than 200 MB' });
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buf));
    } catch {
      return reply.code(400).send({ error: 'That file is not a valid zip archive' });
    }
    const files = Object.entries(entries)
      .filter(([path, data]) => !path.endsWith('/') && data.byteLength > 0)
      .map(([path, data]) => ({ path, data }));
    if (!files.length) return reply.code(400).send({ error: 'The zip is empty' });
    try {
      const summary = await catalog.ingestBundle(files, r.id);
      if (!summary.noteCount) return reply.code(400).send({ error: 'No markdown notes found in the zip. Zip the vault folder itself.' });
      // `path` keeps the client's VaultInput.filePath contract: it now carries the bundle id.
      return { path: summary.bundle, sizeBytes: summary.sizeBytes, noteCount: summary.noteCount, attachmentCount: summary.attachmentCount, skipped: summary.skipped, fee: platformFee(0) };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });

  app.post('/uploads/cover', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'Attach the image as multipart field "file"' });
    if (!/^image\/(png|jpeg|webp|gif)$/.test(part.mimetype)) return reply.code(400).send({ error: 'Cover must be a PNG, JPEG, WebP or GIF' });
    const buf = await part.toBuffer();
    if (buf.byteLength > MAX_COVER_BYTES) return reply.code(413).send({ error: 'Cover must be under 5 MB' });
    try {
      return { url: await catalog.uploadCoverImage(buf, part.filename || 'cover') };
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'Upload failed' });
    }
  });

}
