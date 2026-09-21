/**
 * The vault catalog: listings and the note index in Postgres (Supabase, service role), the
 * bytes in the vault store (vault-store.ts). Returns the app's own `Vault` / `VaultNote`
 * shapes so nothing else in the server knows a table name.
 *
 * Two homes, one rule: Postgres answers every question (list, filter, sort, who owns what,
 * how much a seller has stored) and the store answers every "give me the bytes". A note is a
 * row here and an object there, joined by (bundle, path).
 *
 * Multi-step writes that must not half-happen (attaching an upload to a listing, the paged
 * list) are SQL functions in supabase/migrations/0018; this module calls them by name.
 */
import { createHash, randomUUID } from 'node:crypto';
import { decodeCursor, encodeCursor } from '../cursor.ts';
import { IS_DEMO, cfg } from '../config.ts';
import { admin } from '../supabase.ts';
import type { ListVaultsParams, SellerSummary, SortMode, Vault, VaultInput, VaultNote, VaultNoteContent, VaultPage, VaultStatus } from '../types.ts';
import * as store from '../vault-store.ts';
import { MARKDOWN_EXT, isIgnoredPath, parseNote, stripCommonRoot } from './markdown.ts';

/** Listings need both Postgres and somewhere to keep the files; demo mode has neither. */
export const CATALOG_ENABLED = !IS_DEMO && store.VAULT_STORE_ENABLED;

type Row = Record<string, any>;

const VAULT_SELECT = '*, seller:profiles(id, username, display_name, avatar_url)';

/** Content hash of one stored file. The Obsidian plugin hashes the buyer's copy the same way. */
const sha256 = (data: Uint8Array | Buffer): string => createHash('sha256').update(data).digest('hex');

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/* ---------- mapping ---------- */

/** GET /files/covers/:name serves the object at covers/<name>; the listing carries the key. */
export function coverUrlFor(key: string | null | undefined): string | null {
  return key ? `${cfg.apiUrl}/files/covers/${key.slice('covers/'.length)}` : null;
}

/** The key behind a cover URL this server handed out, or null for anything else (including no cover). */
function coverKeyFrom(url: string | null | undefined): string | null {
  const m = url ? /\/files\/covers\/([\w.-]+)$/.exec(url) : null;
  return m ? store.coverKey(m[1]) : null;
}

function toSeller(p: Row | null | undefined): SellerSummary | undefined {
  return p?.id ? { id: p.id, username: p.username ?? '', displayName: p.display_name ?? p.username ?? 'Seller', avatarUrl: p.avatar_url ?? null } : undefined;
}

function toVault(r: Row, seller?: SellerSummary): Vault {
  return {
    id: r.id,
    sellerId: r.seller_id ?? '',
    seller: seller ?? toSeller(r.seller),
    title: r.title ?? '',
    tagline: r.tagline ?? '',
    description: r.description ?? '',
    category: r.category,
    tags: r.tags ?? [],
    priceCents: r.price_cents ?? 0,
    currency: r.currency ?? 'INR',
    coverUrl: coverUrlFor(r.cover_key),
    screenshots: r.screenshots ?? [],
    plugins: r.plugins ?? [],
    noteCount: r.note_count ?? 0,
    sizeBytes: Number(r.size_bytes ?? 0),
    version: r.version ?? '1.0',
    filePath: r.bundle ?? null,
    entryNote: r.entry_note ?? null,
    pluginOnly: !!r.plugin_only,
    status: (r.status ?? 'draft') as VaultStatus,
    downloads: r.downloads ?? 0,
    ratingAvg: Number(r.rating_avg ?? 0),
    ratingCount: r.rating_count ?? 0,
    featured: !!r.featured,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toNote(r: Row): VaultNote {
  return { path: r.path, title: r.title ?? r.path, folder: r.folder ?? '', isPreview: !!r.is_preview, sizeBytes: r.size_bytes ?? 0, tags: r.tags ?? [], links: r.links ?? [] };
}

/** Sellers for rows that came back without the join (the list function returns bare vaults). */
async function sellersFor(rows: Row[]): Promise<Map<string, SellerSummary>> {
  const ids = [...new Set(rows.map((r) => r.seller_id).filter(Boolean))];
  const out = new Map<string, SellerSummary>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin().from('profiles').select('id, username, display_name, avatar_url').in('id', ids.slice(i, i + 200));
    fail(error);
    for (const p of data ?? []) out.set(p.id, toSeller(p)!);
  }
  return out;
}

/* ---------- reads ---------- */

/** The sort keys each mode pages by, read off a row for the next cursor. */
const SORT_VALUES: Record<SortMode, (r: Row) => (number | string)[]> = {
  popular: (r) => [r.downloads ?? 0],
  new: (r) => [r.created_at],
  top: (r) => [Number(r.rating_avg ?? 0), r.rating_count ?? 0],
};

/** One page, keyset-paged: asks for one row past the limit to learn whether a next page exists. */
export async function listVaults(params: ListVaultsParams = {}): Promise<VaultPage> {
  const sort: SortMode = params.sort ?? 'popular';
  const limit = params.limit ?? 50;
  const cursor = decodeCursor(params.cursor, SORT_VALUES[sort]({}).length);
  if (params.cursor && !cursor) throw Object.assign(new Error('Bad cursor'), { statusCode: 400 });
  const { data, error } = await admin().rpc('catalog_list_vaults', {
    p_sort: sort,
    p_limit: limit + 1,
    p_category: params.category ?? null,
    p_search: params.search?.trim() || null,
    p_featured: !!params.featured,
    p_free: !!params.freeOnly,
    p_cursor: cursor ? { values: cursor.values, id: cursor.id } : null,
  });
  fail(error);
  const rows = (data ?? []) as Row[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const sellers = await sellersFor(page);
  return {
    items: page.map((r) => toVault(r, sellers.get(r.seller_id))),
    nextCursor: rows.length > limit && last ? encodeCursor({ values: SORT_VALUES[sort](last), id: last.id }) : null,
  };
}

export async function getVault(id: string): Promise<Vault | null> {
  const { data, error } = await admin().from('vaults').select(VAULT_SELECT).eq('id', id).maybeSingle();
  fail(error);
  return data ? toVault(data) : null;
}

export async function getVaultsByIds(ids: string[]): Promise<Vault[]> {
  if (!ids.length) return [];
  const { data, error } = await admin().from('vaults').select(VAULT_SELECT).in('id', ids.slice(0, 200));
  fail(error);
  return (data ?? []).map((r) => toVault(r));
}

export async function getSellerVaults(userId: string, includeUnpublished = false): Promise<Vault[]> {
  let q = admin().from('vaults').select(VAULT_SELECT).eq('seller_id', userId);
  q = includeUnpublished ? q.order('updated_at', { ascending: false }) : q.eq('status', 'published').order('downloads', { ascending: false });
  const { data, error } = await q;
  fail(error);
  return (data ?? []).map((r) => toVault(r));
}

export async function getSeller(userId: string): Promise<(SellerSummary & { bio?: string | null; createdAt: string }) | null> {
  const { data, error } = await admin().from('profiles').select('id, username, display_name, avatar_url, bio, created_at').eq('id', userId).maybeSingle();
  fail(error);
  if (!data) return null;
  return { ...toSeller(data)!, bio: data.bio ?? null, createdAt: data.created_at };
}

/** The bundle a vault's notes come from, or null for a listing with nothing attached yet. */
async function bundleOf(vaultId: string): Promise<string | null> {
  const { data, error } = await admin().from('vaults').select('bundle').eq('id', vaultId).maybeSingle();
  fail(error);
  return data?.bundle ?? null;
}

export async function listNotes(vaultId: string): Promise<VaultNote[]> {
  const bundle = await bundleOf(vaultId);
  if (!bundle) return [];
  const { data, error } = await admin().from('notes').select('path, title, folder, is_preview, size_bytes, tags, links').eq('bundle', bundle).order('path');
  fail(error);
  return (data ?? []).map(toNote);
}

export async function getNote(vaultId: string, path: string): Promise<VaultNoteContent | null> {
  const bundle = await bundleOf(vaultId);
  if (!bundle) return null;
  const clean = path.replace(/^\/+/, '');
  // "Home" reaches "Home.md", the way Obsidian links do.
  const candidates = MARKDOWN_EXT.test(clean) ? [clean] : [clean, `${clean}.md`];
  const { data, error } = await admin().from('notes').select('*').eq('bundle', bundle).in('path', candidates);
  fail(error);
  const row = (data ?? []).find((r) => r.path === candidates[0]) ?? (data ?? [])[0];
  if (!row) return null;
  const body = await store.readObject(store.fileKey(bundle, row.path));
  return { ...toNote(row), content: body?.toString('utf8') ?? '', frontmatter: (row.frontmatter as Record<string, unknown>) ?? {} };
}

/** Every note body of a vault, for the MCP tools and in-vault search. A few hundred small reads. */
export async function getAllNoteContents(vaultId: string): Promise<{ path: string; content: string }[]> {
  const bundle = await bundleOf(vaultId);
  if (!bundle) return [];
  const { data, error } = await admin().from('notes').select('path').eq('bundle', bundle).order('path');
  fail(error);
  const paths = (data ?? []).map((r) => r.path as string);
  const bodies = await store.readObjects(paths.map((p) => store.fileKey(bundle, p)));
  return paths.map((path, i) => ({ path, content: bodies[i]?.toString('utf8') ?? '' }));
}

/**
 * Every file of a vault with a content hash: what the Obsidian plugin diffs against before it
 * writes anything (routes/sync.ts). Notes and attachments together, since a vault is both.
 *
 * Bundles ingested before 0019 have no stored hash; theirs are computed from the store here and
 * not written back, so an old listing still syncs and a re-upload ends the cost.
 */
export async function vaultManifest(vaultId: string): Promise<{ path: string; hash: string; sizeBytes: number }[]> {
  const bundle = await bundleOf(vaultId);
  if (!bundle) return [];
  const [notes, attachments] = await Promise.all([
    admin().from('notes').select('path, hash, size_bytes').eq('bundle', bundle),
    admin().from('attachments').select('path, hash, size_bytes').eq('bundle', bundle),
  ]);
  fail(notes.error);
  fail(attachments.error);
  const rows = [...(notes.data ?? []), ...(attachments.data ?? [])] as Row[];
  const missing = rows.filter((r) => !r.hash);
  if (missing.length) {
    const bodies = await store.readObjects(missing.map((r) => store.fileKey(bundle, r.path)));
    missing.forEach((r, i) => (r.hash = bodies[i] ? sha256(bodies[i]!) : ''));
  }
  return rows
    .map((r) => ({ path: r.path as string, hash: r.hash as string, sizeBytes: r.size_bytes ?? 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The bodies for the paths the plugin decided it needs. A path that is not there comes back
 * missing rather than as an error; a vault may hold only text (catalog/file-policy.ts), so
 * utf-8 is the whole story.
 */
export async function readVaultFiles(vaultId: string, paths: string[]): Promise<{ path: string; content: string }[]> {
  const bundle = await bundleOf(vaultId);
  if (!bundle) return [];
  const bodies = await store.readObjects(paths.map((p) => store.fileKey(bundle, p)));
  return paths
    .map((path, i) => ({ path, body: bodies[i] }))
    .filter((f) => f.body)
    .map((f) => ({ path: f.path, content: f.body!.toString('utf8') }));
}

/** Case-insensitive substring search over titles, paths and bodies. Owners only; the route checks. */
export async function searchNotes(vaultId: string, query: string, limit = 20): Promise<{ path: string; title: string; snippet: string }[]> {
  const q = query.toLowerCase();
  const [notes, contents] = await Promise.all([listNotes(vaultId), getAllNoteContents(vaultId)]);
  const titles = new Map(notes.map((n) => [n.path, n.title]));
  const hits: { path: string; title: string; snippet: string }[] = [];
  for (const { path, content } of contents) {
    const title = titles.get(path) ?? path;
    const i = content.toLowerCase().indexOf(q);
    if (i === -1 && !path.toLowerCase().includes(q) && !title.toLowerCase().includes(q)) continue;
    hits.push({ path, title, snippet: i === -1 ? '' : `…${content.slice(Math.max(0, i - 80), i + q.length + 80).replace(/\s+/g, ' ')}…` });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** The buyer's download: the scanned zip, streamed from the store. Null when nothing is attached. */
export async function openVaultZip(vault: Pick<Vault, 'filePath'>): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
  return vault.filePath ? store.streamObject(store.zipKey(vault.filePath)) : null;
}

/** What a seller's listings occupy. `excludeVaultId` is the one a replacement zip will overwrite. */
export async function storageUsed(userId: string, excludeVaultId?: string): Promise<number> {
  const { data, error } = await admin().rpc('catalog_seller_storage', { p_seller: userId, p_exclude: excludeVaultId ?? null });
  fail(error);
  return Number(data ?? 0);
}

/* ---------- writes ---------- */

export interface SellerInput {
  userId: string;
  username: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'vault';
}

/** Creates or updates a listing. `input.filePath` carries the upload bundle id to attach. */
export async function saveVault(input: VaultInput, seller: SellerInput, id?: string): Promise<Vault> {
  const fields: Row = {
    title: input.title,
    tagline: input.tagline,
    description: input.description,
    category: input.category,
    tags: input.tags,
    price_cents: input.priceCents,
    plugins: input.plugins,
    version: input.version,
  };
  if (input.screenshots !== undefined) fields.screenshots = input.screenshots;
  if (input.entryNote !== undefined) fields.entry_note = input.entryNote;
  if (input.pluginOnly !== undefined) fields.plugin_only = !!input.pluginOnly;
  if (input.coverUrl !== undefined) fields.cover_key = coverKeyFrom(input.coverUrl);

  let vaultId = id;
  if (vaultId) {
    const { data: existing, error } = await admin().from('vaults').select('seller_id, cover_key').eq('id', vaultId).maybeSingle();
    fail(error);
    if (!existing) throw new Error('Listing not found');
    if (existing.seller_id !== seller.userId) throw new Error('Not your listing');
    const { error: uErr } = await admin().from('vaults').update(fields).eq('id', vaultId);
    fail(uErr);
    // A replaced cover leaves its old object behind unless it is dropped here.
    if ('cover_key' in fields && existing.cover_key && existing.cover_key !== fields.cover_key) await store.removeObject(existing.cover_key);
  } else {
    const { data: created, error } = await admin()
      .from('vaults')
      .insert({ ...fields, seller_id: seller.userId, slug: `${slugify(input.title)}-${Date.now().toString(36)}`, currency: 'INR', status: 'draft' })
      .select('id')
      .single();
    fail(error);
    vaultId = created!.id as string;
  }

  if (input.filePath) await attachBundle(vaultId, input.filePath);
  if (input.status) await setVaultStatus(vaultId, input.status, seller.userId);

  const v = await getVault(vaultId);
  if (!v) throw new Error('Listing vanished after save');
  return v;
}

export async function setVaultStatus(id: string, status: VaultStatus, sellerUserId: string): Promise<void> {
  const { data, error } = await admin().from('vaults').select('seller_id, note_count').eq('id', id).maybeSingle();
  fail(error);
  if (!data) throw new Error('Listing not found');
  if (data.seller_id !== sellerUserId) throw new Error('Not your listing');
  if (status === 'published' && !(data.note_count > 0)) throw new Error('Upload the vault notes before publishing.');
  const { error: uErr } = await admin().from('vaults').update({ status }).eq('id', id);
  fail(uErr);
}

/** Removes the listing, its bundles' rows and objects, and its cover. Purchases of it are kept. */
export async function deleteVault(id: string, sellerUserId: string): Promise<void> {
  const { data, error } = await admin().from('vaults').select('seller_id, cover_key').eq('id', id).maybeSingle();
  fail(error);
  if (!data) return;
  if (data.seller_id !== sellerUserId) throw new Error('Not your listing');
  const { data: bundles, error: bErr } = await admin().from('bundles').select('id').eq('vault_id', id);
  fail(bErr);
  for (const b of bundles ?? []) await store.removeBundleObjects(b.id);
  const { error: dbErr } = await admin().from('bundles').delete().eq('vault_id', id);
  fail(dbErr);
  const { error: dErr } = await admin().from('vaults').delete().eq('id', id);
  fail(dErr);
  if (data.cover_key) await store.removeObject(data.cover_key);
}

/** Puts the image in the store and hands back the URL the listing form saves as coverUrl. */
export async function uploadCoverImage(data: Uint8Array, filename: string): Promise<string> {
  const ext = /\.(png|jpe?g|webp|gif)$/i.exec(filename)?.[1]?.toLowerCase() ?? 'jpg';
  const key = store.coverKey(`${randomUUID()}.${ext}`);
  await store.putObject(key, data, store.contentTypeFor(key));
  return coverUrlFor(key)!;
}

export async function incrementDownloads(id: string): Promise<void> {
  if (!id) return;
  await admin().rpc('catalog_increment_downloads', { p_vault_id: id }).then(({ error }) => error && console.warn('increment_downloads:', error.message));
}

/** Recomputes a listing's rating from its reviews. The trigger keeps it current; this is for a manual nudge. */
export async function refreshRating(id: string): Promise<{ ratingAvg: number; ratingCount: number }> {
  const { data, error } = await admin().rpc('catalog_refresh_rating', { p_vault_id: id });
  fail(error);
  const row = (data as Row[] | null)?.[0];
  return { ratingAvg: Number(row?.rating_avg ?? 0), ratingCount: row?.rating_count ?? 0 };
}

/* ---------- uploads: a zip becomes a bundle ---------- */

export interface BundleFile {
  /** Path inside the zip. */
  path: string;
  data: Uint8Array;
}

export interface BundleSummary {
  bundle: string;
  noteCount: number;
  attachmentCount: number;
  sizeBytes: number;
  skipped: string[];
}

const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * What `ingestBundle` would store for these files, for a quota check that has to run before
 * anything is written. It applies the same three rules the loop below does, so keep the two in
 * step: the common root is stripped, ignored paths are dropped, and a file over its type's cap
 * is skipped rather than stored.
 */
export function bundleBytes(files: BundleFile[]): number {
  const strip = stripCommonRoot(files.map((f) => f.path));
  let total = 0;
  for (const file of files) {
    const path = strip(file.path);
    if (!path || isIgnoredPath(path)) continue;
    const cap = MARKDOWN_EXT.test(path) ? MAX_NOTE_BYTES : MAX_ATTACHMENT_BYTES;
    if (file.data.byteLength > cap) continue;
    total += file.data.byteLength;
  }
  return total;
}

async function insertChunked(table: string, rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin().from(table).insert(rows.slice(i, i + 500));
    fail(error);
  }
}

/**
 * Writes an uploaded zip's files to the store and its index to Postgres, under a new bundle id
 * with no vault yet. `attachBundle` links it when the listing is saved, so uploading before the
 * listing exists works. `zip` is the archive itself, kept as the buyer's download.
 *
 * Half an ingest is worse than none: on any failure what was written is removed again.
 */
export async function ingestBundle(files: BundleFile[], uploaderUserId: string, zip?: Uint8Array): Promise<BundleSummary> {
  const bundle = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const strip = stripCommonRoot(files.map((f) => f.path));
  const decoder = new TextDecoder('utf-8');
  const skipped: string[] = [];
  const notes: Row[] = [];
  const attachments: Row[] = [];
  const objects: { key: string; data: Uint8Array; contentType: string }[] = [];
  let sizeBytes = 0;

  for (const file of files) {
    const path = strip(file.path);
    if (!path || isIgnoredPath(path)) continue;
    const cap = MARKDOWN_EXT.test(path) ? MAX_NOTE_BYTES : MAX_ATTACHMENT_BYTES;
    if (file.data.byteLength > cap) {
      skipped.push(path);
      continue;
    }
    objects.push({ key: store.fileKey(bundle, path), data: file.data, contentType: store.contentTypeFor(path) });
    if (MARKDOWN_EXT.test(path)) {
      const meta = parseNote(path, decoder.decode(file.data));
      notes.push({
        bundle,
        path,
        title: meta.title,
        folder: meta.folder,
        frontmatter: meta.frontmatter,
        tags: meta.tags,
        links: meta.links,
        is_preview: /^(readme|home|start here|index)\.md$/i.test(path),
        hash: sha256(file.data),
        size_bytes: file.data.byteLength,
        position: notes.length,
      });
    } else {
      attachments.push({ bundle, path, mime_type: store.contentTypeFor(path), hash: sha256(file.data), size_bytes: file.data.byteLength });
    }
    sizeBytes += file.data.byteLength;
  }

  const { error: bErr } = await admin().from('bundles').insert({ id: bundle, uploader_id: uploaderUserId, note_count: notes.length, attachment_count: attachments.length, size_bytes: sizeBytes });
  fail(bErr);
  try {
    await store.putObjects(objects);
    if (zip) await store.putObject(store.zipKey(bundle), zip, 'application/zip');
    await insertChunked('notes', notes);
    await insertChunked('attachments', attachments);
  } catch (e) {
    await store.removeBundleObjects(bundle).catch(() => {});
    await admin().from('bundles').delete().eq('id', bundle);
    throw e;
  }
  return { bundle, noteCount: notes.length, attachmentCount: attachments.length, sizeBytes, skipped };
}

/** Points a bundle at the vault, drops the vault's previous contents (rows and objects), refreshes counts. */
export async function attachBundle(vaultId: string, bundle: string): Promise<void> {
  const { data, error } = await admin().rpc('catalog_attach_bundle', { p_vault_id: vaultId, p_bundle: bundle });
  fail(error);
  for (const stale of (data ?? []) as string[]) await store.removeBundleObjects(stale);
}

/** Uploads nobody saved: their objects, then their rows. Returns how many were swept. */
export async function sweepStaleBundles(olderThanDays = 2): Promise<number> {
  const { data, error } = await admin().rpc('catalog_stale_bundles', { p_days: olderThanDays });
  fail(error);
  const ids = (data ?? []) as string[];
  for (const id of ids) {
    await store.removeBundleObjects(id);
    const { error: dErr } = await admin().from('bundles').delete().eq('id', id);
    fail(dErr);
  }
  return ids.length;
}
