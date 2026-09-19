/**
 * Who bought each vault, and what they said about it.
 *
 * Purchases and reviews carry text vault ids with no foreign key to the listings (older rows
 * predate the catalog's move into Postgres), so this reads the rows with the service role,
 * groups them by vault, and hydrates the vault from the catalog afterwards. A vault that has
 * since been deleted still has its purchases, so a row's `vault` can be null and the id is
 * carried separately.
 *
 * Two readers, one shape. A seller sees this for their own vaults and the operator for all
 * of them; the routes decide who may ask, this only answers.
 */
import type { AdminOverview, AdminVaultRow, PurchaseRecord, Review, UserSummary, Vault, VaultInsights, VaultSales } from './types.ts';
import { cfg } from './config.ts';
import * as catalog from './catalog/index.ts';
import { admin } from './supabase.ts';

type Row = Record<string, any>;

const PURCHASE_COLUMNS = 'id, vault_id, buyer_id, amount_cents, fee_cents, buyer_country, created_at, clears_at, settled_at';

/** Public profile fields for a set of users, keyed by id. Missing profiles are simply absent. */
async function profilesById(ids: Iterable<string>): Promise<Map<string, UserSummary>> {
  const unique = [...new Set([...ids].filter(Boolean))];
  const out = new Map<string, UserSummary>();
  // Chunked so a vault with thousands of buyers does not become one enormous IN clause.
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await admin().from('profiles').select('id, username, display_name, avatar_url').in('id', unique.slice(i, i + 200));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as Row[]) {
      out.set(p.id, { id: p.id, username: p.username, displayName: p.display_name ?? p.username, avatarUrl: p.avatar_url ?? null });
    }
  }
  return out;
}

function emptySales(vaultId: string): VaultSales {
  return { vaultId, sales: 0, freeClaims: 0, buyers: 0, grossCents: 0, feeCents: 0, netCents: 0, lastPurchaseAt: null };
}

/** Folds purchase rows into one VaultSales per vault. */
function groupSales(rows: Row[]): Map<string, VaultSales> {
  const totals = new Map<string, VaultSales>();
  const buyers = new Map<string, Set<string>>();
  for (const p of rows) {
    let t = totals.get(p.vault_id);
    if (!t) totals.set(p.vault_id, (t = emptySales(p.vault_id)));
    const amount = p.amount_cents ?? 0;
    const fee = p.fee_cents ?? 0;
    if (amount > 0) {
      t.sales++;
      t.grossCents += amount;
      t.feeCents += fee;
      t.netCents += amount - fee;
    } else {
      t.freeClaims++;
    }
    if (!t.lastPurchaseAt || p.created_at > t.lastPurchaseAt) t.lastPurchaseAt = p.created_at;
    let b = buyers.get(p.vault_id);
    if (!b) buyers.set(p.vault_id, (b = new Set()));
    b.add(p.buyer_id);
  }
  for (const [id, t] of totals) t.buyers = buyers.get(id)?.size ?? 0;
  return totals;
}

function toPurchase(p: Row, buyers: Map<string, UserSummary>): PurchaseRecord {
  return {
    id: p.id,
    vaultId: p.vault_id,
    buyer: buyers.get(p.buyer_id) ?? null,
    amountCents: p.amount_cents ?? 0,
    feeCents: p.fee_cents ?? 0,
    buyerCountry: p.buyer_country ?? null,
    createdAt: p.created_at,
    clearsAt: p.clears_at ?? null,
    settledAt: p.settled_at ?? null,
  };
}

function toReview(r: Row, authors: Map<string, UserSummary>): Review {
  return { id: r.id, vaultId: r.vault_id, userId: r.user_id, rating: r.rating, body: r.body ?? '', createdAt: r.created_at, author: authors.get(r.user_id) };
}

/** How each of `vaultIds` has sold. Vaults nobody has bought come back with zeros, not missing. */
export async function salesForVaults(vaultIds: string[]): Promise<VaultSales[]> {
  if (!vaultIds.length) return [];
  const { data, error } = await admin().from('purchases').select(PURCHASE_COLUMNS).in('vault_id', vaultIds);
  if (error) throw new Error(error.message);
  const grouped = groupSales((data ?? []) as Row[]);
  return vaultIds.map((id) => grouped.get(id) ?? emptySales(id));
}

/** One vault's buyers and reviews in full. `vault` may already be in hand; otherwise it is fetched. */
export async function vaultInsights(vaultId: string, vault?: Vault | null): Promise<VaultInsights> {
  const db = admin();
  const [{ data: purchases, error: pErr }, { data: reviews, error: rErr }, v] = await Promise.all([
    db.from('purchases').select(PURCHASE_COLUMNS).eq('vault_id', vaultId).order('created_at', { ascending: false }),
    db.from('reviews').select('*').eq('vault_id', vaultId).order('created_at', { ascending: false }),
    vault === undefined ? catalog.getVault(vaultId) : Promise.resolve(vault),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);

  const pRows = (purchases ?? []) as Row[];
  const rRows = (reviews ?? []) as Row[];
  const people = await profilesById([...pRows.map((p) => p.buyer_id), ...rRows.map((r) => r.user_id)]);

  const breakdown: VaultInsights['ratingBreakdown'] = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const r of rRows) {
    const star = Math.min(5, Math.max(1, Number(r.rating) || 0));
    breakdown[star - 1]++;
    sum += star;
  }

  return {
    vaultId,
    vault: v,
    sales: groupSales(pRows).get(vaultId) ?? emptySales(vaultId),
    ratingAvg: rRows.length ? Math.round((sum / rRows.length) * 100) / 100 : 0,
    ratingCount: rRows.length,
    ratingBreakdown: breakdown,
    purchases: pRows.map((p) => toPurchase(p, people)),
    reviews: rRows.map((r) => toReview(r, people)),
  };
}

/** Every published listing, walked page by page. Bounded so a runaway cursor cannot loop forever. */
async function allPublishedVaults(): Promise<Vault[]> {
  const out: Vault[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const { items, nextCursor } = await catalog.listVaults({ sort: 'new', limit: 100, cursor });
    out.push(...items);
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

/**
 * The whole marketplace at a glance: what has been bought, how each vault is doing, and the
 * latest purchases. Listings nobody has bought yet are included, so the operator sees the
 * catalog rather than only the part of it that has sold.
 */
export async function adminOverview(recentLimit = 50): Promise<AdminOverview> {
  const db = admin();
  const [{ data: purchases, error: pErr }, { count: sellers, error: sErr }, published] = await Promise.all([
    db.from('purchases').select(PURCHASE_COLUMNS).order('created_at', { ascending: false }),
    db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_seller', true),
    allPublishedVaults(),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (sErr) throw new Error(sErr.message);

  const rows = (purchases ?? []) as Row[];
  const grouped = groupSales(rows);

  // Purchased vaults that are unpublished or deleted are not in the published list; fetch them by id.
  const known = new Map(published.map((v) => [v.id, v]));
  const missing = [...grouped.keys()].filter((id) => !known.has(id));
  for (const v of await catalog.getVaultsByIds(missing)) known.set(v.id, v);

  const vaultIds = new Set([...known.keys(), ...grouped.keys()]);
  const vaults: AdminVaultRow[] = [...vaultIds].map((id) => ({ vaultId: id, vault: known.get(id) ?? null, sales: grouped.get(id) ?? emptySales(id) }));
  vaults.sort((a, b) => b.sales.buyers - a.sales.buyers || b.sales.grossCents - a.sales.grossCents || (b.vault?.createdAt ?? '').localeCompare(a.vault?.createdAt ?? ''));

  const recentRows = rows.slice(0, recentLimit);
  const buyers = await profilesById(recentRows.map((p) => p.buyer_id));
  const recent = recentRows.map((p) => ({ ...toPurchase(p, buyers), vaultTitle: known.get(p.vault_id)?.title ?? null }));

  let gross = 0;
  let fee = 0;
  let sales = 0;
  const distinctBuyers = new Set<string>();
  for (const p of rows) {
    distinctBuyers.add(p.buyer_id);
    if ((p.amount_cents ?? 0) > 0) {
      sales++;
      gross += p.amount_cents;
      fee += p.fee_cents ?? 0;
    }
  }

  return {
    totals: {
      purchases: rows.length,
      sales,
      buyers: distinctBuyers.size,
      sellers: sellers ?? 0,
      vaults: known.size,
      grossCents: gross,
      feeCents: fee,
      netCents: gross - fee,
      currency: cfg.platformCurrency,
    },
    vaults,
    recent,
  };
}
