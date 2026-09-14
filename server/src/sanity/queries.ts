/** GROQ for the vault catalog. Kept as plain strings so both Node and bundlers can share them. */

export const VAULT_PROJECTION = `{
  _id, _createdAt, _updatedAt,
  title, "slug": slug.current, tagline, description, category, tags,
  priceCents, currency, "coverUrl": coalesce(cover.asset->url + "?w=1200&fit=max&auto=format", coverUrl), screenshots, plugins,
  noteCount, sizeBytes, version, entryNote, bundle, status,
  downloads, ratingAvg, ratingCount, featured,
  "seller": seller->{ "id": userId, username, displayName, avatarUrl }
}`;

export const NOTE_META_PROJECTION = `{ _id, path, title, folder, isPreview, sizeBytes, tags, links }`;

export type ListSort = 'new' | 'popular' | 'top';

/**
 * The GROQ expressions each sort orders by, most significant first. Optional fields are coalesced
 * so a document missing one still has a definite place in the order, which keyset paging needs.
 * `_id` is always the final tie-break.
 */
export const SORT_KEYS: Record<ListSort, string[]> = {
  popular: ['coalesce(downloads, 0)'],
  new: ['_createdAt'],
  top: ['coalesce(ratingAvg, 0)', 'coalesce(ratingCount, 0)'],
};

/** The raw document fields the sort keys read, in the same order, for building the next cursor. */
export const SORT_FIELDS: Record<ListSort, ((d: Record<string, any>) => number | string)[]> = {
  popular: [(d) => d.downloads ?? 0],
  new: [(d) => d._createdAt],
  top: [(d) => Number(d.ratingAvg ?? 0), (d) => d.ratingCount ?? 0],
};

/** "Rows after the cursor" for a descending sort: k0 < c0, or equal and the next key decides, ending on _id. */
function afterCursor(keys: string[], i = 0): string {
  if (i === keys.length) return '_id > $cid';
  return `(${keys[i]} < $c${i} || (${keys[i]} == $c${i} && ${afterCursor(keys, i + 1)}))`;
}

/** Builds the filter + ordering for the public catalog list. */
export function vaultListQuery(opts: {
  category?: string;
  search?: string;
  featured?: boolean;
  freeOnly?: boolean;
  sort?: ListSort;
  cursor?: { values: (number | string)[]; id: string } | null;
}): { query: string; params: Record<string, unknown> } {
  const where = ['_type == "vault"', 'status == "published"'];
  const params: Record<string, unknown> = {};
  const keys = SORT_KEYS[opts.sort ?? 'popular'];
  if (opts.category) {
    where.push('category == $category');
    params.category = opts.category;
  }
  if (opts.featured) where.push('featured == true');
  if (opts.freeOnly) where.push('priceCents == 0');
  if (opts.search?.trim()) {
    where.push('(title match $q || tagline match $q || $tag in tags || $tag in plugins[]->lower())');
    params.q = `${opts.search.trim()}*`;
    params.tag = opts.search.trim().toLowerCase();
  }
  if (opts.cursor) {
    where.push(afterCursor(keys));
    opts.cursor.values.forEach((v, i) => (params[`c${i}`] = v));
    params.cid = opts.cursor.id;
  }
  const order = `order(${keys.map((k) => `${k} desc`).join(', ')}, _id asc)`;
  return { query: `*[${where.join(' && ')}] | ${order} [0...$limit] ${VAULT_PROJECTION}`, params };
}

export const VAULT_BY_ID = `*[_type == "vault" && _id == $id][0] ${VAULT_PROJECTION}`;
export const VAULTS_BY_IDS = `*[_type == "vault" && _id in $ids] ${VAULT_PROJECTION}`;
export const SELLER_PUBLISHED_VAULTS = `*[_type == "vault" && status == "published" && seller->userId == $userId] | order(downloads desc) ${VAULT_PROJECTION}`;
export const SELLER_ALL_VAULTS = `*[_type == "vault" && seller->userId == $userId] | order(_updatedAt desc) ${VAULT_PROJECTION}`;
export const SELLER_BY_USER = `*[_type == "seller" && userId == $userId][0]{ _id, userId, username, displayName, bio, avatarUrl, _createdAt }`;

export const VAULT_NOTES = `*[_type == "note" && vault._ref == $vaultId] | order(path asc) ${NOTE_META_PROJECTION}`;
export const VAULT_NOTE = `*[_type == "note" && vault._ref == $vaultId && path == $path][0] { ...${NOTE_META_PROJECTION}, content, frontmatter }`;
export const VAULT_NOTES_WITH_CONTENT = `*[_type == "note" && vault._ref == $vaultId] | order(path asc) { path, content }`;
export const VAULT_NOTES_SEARCH = `*[_type == "note" && vault._ref == $vaultId && (content match $q || path match $q || title match $q)] | order(path asc) [0...$limit] { path, title, content }`;
export const VAULT_ATTACHMENTS = `*[_type == "attachment" && vault._ref == $vaultId] { path, mimeType, sizeBytes, "url": file.asset->url }`;
export const BUNDLE_DOC_IDS = `*[_type in ["note", "attachment"] && bundle == $bundle]._id`;
export const VAULT_CONTENT_IDS = `*[_type in ["note", "attachment"] && vault._ref == $vaultId && bundle != $keepBundle]._id`;
export const BUNDLE_SUMMARY = `{
  "noteCount": count(*[_type == "note" && bundle == $bundle]),
  "sizeBytes": math::sum(*[_type in ["note", "attachment"] && bundle == $bundle].sizeBytes)
}`;
