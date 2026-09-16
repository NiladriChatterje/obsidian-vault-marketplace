/**
 * Typed reads and writes over the Sanity vault catalog. Returns the app's own
 * `Vault` shape so the rest of the code does not know about Sanity documents.
 */
import { decodeCursor, encodeCursor } from '../cursor.ts';
import type { ListVaultsParams, SellerSummary, Vault, VaultInput, VaultNote, VaultPage, VaultStatus } from '../types.ts';
import { requireWriteToken, sanity } from './client.ts';
import { MARKDOWN_EXT, isIgnoredPath, parseNote, stripCommonRoot } from './markdown.ts';
import * as Q from './queries.ts';

type Doc = Record<string, any>;

function toVault(d: Doc): Vault {
  return {
    id: d._id,
    sellerId: d.seller?.id ?? '',
    seller: d.seller?.id
      ? { id: d.seller.id, username: d.seller.username ?? '', displayName: d.seller.displayName ?? d.seller.username ?? 'Seller', avatarUrl: d.seller.avatarUrl ?? null }
      : undefined,
    title: d.title ?? '',
    tagline: d.tagline ?? '',
    description: d.description ?? '',
    category: d.category,
    tags: d.tags ?? [],
    priceCents: d.priceCents ?? 0,
    currency: d.currency ?? 'INR',
    coverUrl: d.coverUrl ?? null,
    screenshots: d.screenshots ?? [],
    plugins: d.plugins ?? [],
    noteCount: d.noteCount ?? 0,
    sizeBytes: d.sizeBytes ?? 0,
    version: d.version ?? '1.0',
    filePath: d.bundle ?? null,
    entryNote: d.entryNote ?? null,
    status: (d.status ?? 'draft') as VaultStatus,
    downloads: d.downloads ?? 0,
    ratingAvg: Number(d.ratingAvg ?? 0),
    ratingCount: d.ratingCount ?? 0,
    featured: !!d.featured,
    createdAt: d._createdAt,
    updatedAt: d._updatedAt,
  };
}

function toNote(d: Doc): VaultNote {
  return {
    path: d.path,
    title: d.title ?? d.path,
    folder: d.folder ?? '',
    isPreview: !!d.isPreview,
    sizeBytes: d.sizeBytes ?? 0,
    tags: d.tags ?? [],
    links: d.links ?? [],
  };
}

/* ---------- reads ---------- */

/** One page, keyset-paged: fetches one row past the limit to learn whether a next page exists. */
export async function listVaults(params: ListVaultsParams = {}): Promise<VaultPage> {
  const sort = params.sort ?? 'popular';
  const limit = params.limit ?? 50;
  const cursor = decodeCursor(params.cursor, Q.SORT_KEYS[sort].length);
  if (params.cursor && !cursor) throw Object.assign(new Error('Bad cursor'), { statusCode: 400 });
  const { query, params: p } = Q.vaultListQuery({ ...params, sort, cursor });
  const docs = await sanity().fetch<Doc[]>(query, { ...p, limit: limit + 1 });
  const page = docs.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = docs.length > limit && last ? encodeCursor({ values: Q.SORT_FIELDS[sort].map((f) => f(last)), id: last._id }) : null;
  return { items: page.map(toVault), nextCursor };
}

export async function getVault(id: string): Promise<Vault | null> {
  const d = await sanity().fetch<Doc | null>(Q.VAULT_BY_ID, { id });
  return d ? toVault(d) : null;
}

export async function getVaultsByIds(ids: string[]): Promise<Vault[]> {
  if (!ids.length) return [];
  const docs = await sanity().fetch<Doc[]>(Q.VAULTS_BY_IDS, { ids });
  return docs.map(toVault);
}

export async function getSellerVaults(userId: string, includeUnpublished = false): Promise<Vault[]> {
  const docs = await sanity().fetch<Doc[]>(includeUnpublished ? Q.SELLER_ALL_VAULTS : Q.SELLER_PUBLISHED_VAULTS, { userId });
  return docs.map(toVault);
}

export async function getSeller(userId: string): Promise<(SellerSummary & { bio?: string | null; createdAt: string }) | null> {
  const d = await sanity().fetch<Doc | null>(Q.SELLER_BY_USER, { userId });
  return d ? { id: d.userId, username: d.username, displayName: d.displayName, avatarUrl: d.avatarUrl ?? null, bio: d.bio ?? null, createdAt: d._createdAt } : null;
}

export async function listNotes(vaultId: string): Promise<VaultNote[]> {
  const docs = await sanity().fetch<Doc[]>(Q.VAULT_NOTES, { vaultId });
  return docs.map(toNote);
}

export async function getNote(vaultId: string, path: string): Promise<(VaultNote & { content: string; frontmatter: Record<string, unknown> }) | null> {
  const clean = path.replace(/^\/+/, '');
  const d =
    (await sanity().fetch<Doc | null>(Q.VAULT_NOTE, { vaultId, path: clean })) ??
    (MARKDOWN_EXT.test(clean) ? null : await sanity().fetch<Doc | null>(Q.VAULT_NOTE, { vaultId, path: `${clean}.md` }));
  if (!d) return null;
  let frontmatter: Record<string, unknown> = {};
  try {
    frontmatter = d.frontmatter ? JSON.parse(d.frontmatter) : {};
  } catch {
    // keep {}
  }
  return { ...toNote(d), content: d.content ?? '', frontmatter };
}

export async function getAllNoteContents(vaultId: string): Promise<{ path: string; content: string }[]> {
  return sanity().fetch(Q.VAULT_NOTES_WITH_CONTENT, { vaultId });
}

export async function searchNotes(vaultId: string, query: string, limit = 20): Promise<{ path: string; title: string; snippet: string }[]> {
  const docs = await sanity().fetch<Doc[]>(Q.VAULT_NOTES_SEARCH, { vaultId, q: `*${query}*`, limit });
  const q = query.toLowerCase();
  return docs.map((d) => {
    const body: string = d.content ?? '';
    const i = body.toLowerCase().indexOf(q);
    const snippet = i === -1 ? '' : `…${body.slice(Math.max(0, i - 80), i + q.length + 80).replace(/\s+/g, ' ')}…`;
    return { path: d.path, title: d.title ?? d.path, snippet };
  });
}

export async function listAttachments(vaultId: string): Promise<{ path: string; url: string | null; mimeType?: string; sizeBytes?: number }[]> {
  return sanity().fetch(Q.VAULT_ATTACHMENTS, { vaultId });
}

/* ---------- writes (server only) ---------- */

export interface SellerInput {
  userId: string;
  username: string;
  displayName: string;
  bio?: string | null;
  avatarUrl?: string | null;
}

/** Creates or refreshes the seller doc; its _id is deterministic so vaults can reference it. */
export async function upsertSeller(s: SellerInput): Promise<string> {
  requireWriteToken();
  const _id = `seller-${s.userId}`;
  await sanity().createOrReplace({ _id, _type: 'seller', userId: s.userId, username: s.username, displayName: s.displayName, bio: s.bio ?? undefined, avatarUrl: s.avatarUrl ?? undefined });
  return _id;
}

/** cdn.sanity.io/images/<project>/<dataset>/<hash>-<w>x<h>.<ext> -> the asset's _id. */
function imageRef(url: string | null | undefined): Doc | undefined {
  const m = url ? /\/([^/]+)-(\d+x\d+)\.(\w+)$/.exec(url.split('?')[0]) : null;
  return m ? { _type: 'image', asset: { _type: 'reference', _ref: `image-${m[1]}-${m[2]}-${m[3]}` } } : undefined;
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) || 'vault';
}

/** Creates or updates a listing. `input.filePath` carries the upload bundle id to attach. */
export async function saveVault(input: VaultInput, seller: SellerInput, id?: string): Promise<Vault> {
  requireWriteToken();
  const sellerId = await upsertSeller(seller);
  const client = sanity();

  const fields: Doc = {
    title: input.title,
    tagline: input.tagline,
    description: input.description,
    category: input.category,
    tags: input.tags,
    priceCents: input.priceCents,
    plugins: input.plugins,
    version: input.version,
  };
  if (input.coverUrl !== undefined) fields.cover = imageRef(input.coverUrl);
  if (input.screenshots !== undefined) fields.screenshots = input.screenshots;
  if (input.entryNote !== undefined) fields.entryNote = input.entryNote ?? undefined;

  let vaultId = id;
  if (vaultId) {
    const existing = await client.fetch<Doc | null>(`*[_type == "vault" && _id == $id][0]{ "sellerUserId": seller->userId, bundle }`, { id: vaultId });
    if (!existing) throw new Error('Listing not found');
    if (existing.sellerUserId !== seller.userId) throw new Error('Not your listing');
    await client.patch(vaultId).set(fields).commit();
  } else {
    const created = await client.create({
      _type: 'vault',
      ...fields,
      slug: { _type: 'slug', current: `${slugify(input.title)}-${Date.now().toString(36)}` },
      seller: { _type: 'reference', _ref: sellerId },
      currency: 'INR',
      status: 'draft',
      downloads: 0,
      ratingAvg: 0,
      ratingCount: 0,
      featured: false,
      noteCount: 0,
      sizeBytes: 0,
    });
    vaultId = created._id;
  }

  if (input.filePath) await attachBundle(vaultId, input.filePath);
  if (input.status) await setVaultStatus(vaultId, input.status, seller.userId);

  const v = await getVault(vaultId);
  if (!v) throw new Error('Listing vanished after save');
  return v;
}

export async function setVaultStatus(id: string, status: VaultStatus, sellerUserId: string): Promise<void> {
  requireWriteToken();
  const d = await sanity().fetch<Doc | null>(`*[_type == "vault" && _id == $id][0]{ "sellerUserId": seller->userId, noteCount }`, { id });
  if (!d) throw new Error('Listing not found');
  if (d.sellerUserId !== sellerUserId) throw new Error('Not your listing');
  if (status === 'published' && !(d.noteCount > 0)) throw new Error('Upload the vault notes before publishing.');
  await sanity().patch(id).set({ status }).commit();
}

export async function deleteVault(id: string, sellerUserId: string): Promise<void> {
  requireWriteToken();
  const d = await sanity().fetch<Doc | null>(`*[_type == "vault" && _id == $id][0]{ "sellerUserId": seller->userId, "coverAsset": cover.asset._ref }`, { id });
  if (!d) return;
  if (d.sellerUserId !== sellerUserId) throw new Error('Not your listing');
  const client = sanity();
  await client.delete({ query: '*[_type in ["note", "attachment"] && vault._ref == $id]', params: { id } });
  await client.delete(id);
  if (d.coverAsset) await client.delete(d.coverAsset).catch(() => {});
}

/** Cover images are Sanity assets; the listing keeps a reference, so `deleteVault` can drop them. */
export async function uploadCoverImage(data: Uint8Array, filename: string): Promise<string> {
  requireWriteToken();
  const asset = await sanity().assets.upload('image', Buffer.from(data), { filename });
  return asset.url;
}

export async function incrementDownloads(id: string): Promise<void> {
  if (!id) return;
  await sanity().patch(id).inc({ downloads: 1 }).commit().catch(() => {});
}

export async function setRating(id: string, ratingAvg: number, ratingCount: number): Promise<void> {
  await sanity().patch(id).set({ ratingAvg, ratingCount }).commit();
}

/* ---------- uploads: a zip becomes note + attachment documents ---------- */

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

/**
 * Writes the files of an uploaded zip as `note`/`attachment` documents tagged
 * with a new bundle id but no vault yet. `attachBundle` links them when the
 * listing is saved, so uploading before the listing exists works.
 */
export async function ingestBundle(files: BundleFile[], uploaderUserId: string): Promise<BundleSummary> {
  requireWriteToken();
  const client = sanity();
  const bundle = `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const strip = stripCommonRoot(files.map((f) => f.path));
  const decoder = new TextDecoder('utf-8');
  const skipped: string[] = [];
  let noteCount = 0;
  let attachmentCount = 0;
  let sizeBytes = 0;

  let tx = client.transaction();
  let pending = 0;
  const flush = async () => {
    if (pending) await tx.commit({ autoGenerateArrayKeys: true });
    tx = client.transaction();
    pending = 0;
  };

  for (const file of files) {
    const path = strip(file.path);
    if (!path || isIgnoredPath(path)) continue;
    if (MARKDOWN_EXT.test(path)) {
      if (file.data.byteLength > MAX_NOTE_BYTES) {
        skipped.push(path);
        continue;
      }
      const content = decoder.decode(file.data);
      const meta = parseNote(path, content);
      tx.create({
        _type: 'note',
        bundle,
        uploaderUserId,
        path,
        title: meta.title,
        folder: meta.folder,
        content,
        frontmatter: JSON.stringify(meta.frontmatter),
        tags: meta.tags,
        links: meta.links,
        isPreview: /^(readme|home|start here|index)\.md$/i.test(path),
        sizeBytes: file.data.byteLength,
        order: noteCount,
      });
      noteCount++;
    } else {
      if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
        skipped.push(path);
        continue;
      }
      const asset = await client.assets.upload('file', Buffer.from(file.data), { filename: path.split('/').pop() });
      tx.create({
        _type: 'attachment',
        bundle,
        uploaderUserId,
        path,
        file: { _type: 'file', asset: { _type: 'reference', _ref: asset._id } },
        mimeType: asset.mimeType,
        sizeBytes: file.data.byteLength,
      });
      attachmentCount++;
    }
    sizeBytes += file.data.byteLength;
    if (++pending >= 50) await flush();
  }
  await flush();
  return { bundle, noteCount, attachmentCount, sizeBytes, skipped };
}

/** Points a bundle's documents at the vault, drops the vault's previous contents, refreshes counts. */
export async function attachBundle(vaultId: string, bundle: string): Promise<void> {
  requireWriteToken();
  const client = sanity();
  const ids = await client.fetch<string[]>(Q.BUNDLE_DOC_IDS, { bundle });
  if (!ids.length) throw new Error('That upload has no files. Upload the zip again.');

  const stale = await client.fetch<string[]>(Q.VAULT_CONTENT_IDS, { vaultId, keepBundle: bundle });
  const tx = client.transaction();
  for (const id of ids) tx.patch(id, (p) => p.set({ vault: { _type: 'reference', _ref: vaultId, _weak: true } }));
  for (const id of stale) tx.delete(id);
  await tx.commit();

  const summary = await client.fetch<{ noteCount: number; sizeBytes: number }>(Q.BUNDLE_SUMMARY, { bundle });
  const entry = await client.fetch<string | null>(`*[_type == "note" && bundle == $bundle && isPreview == true] | order(path asc) [0].path`, { bundle });
  await client
    .patch(vaultId)
    .set({ bundle, noteCount: summary.noteCount, sizeBytes: summary.sizeBytes ?? 0, ...(entry ? { entryNote: entry } : {}) })
    .commit();
}
