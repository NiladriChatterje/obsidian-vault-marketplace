/**
 * What the platform owes each seller, and what it has paid.
 *
 * Dodo settles every sale to the platform as one amount, so a seller's share is a debt the
 * platform carries until it transfers the money itself. This is the record of that.
 *
 * The seller's share is the list price less the commission (`amount_cents - fee_cents`),
 * which is a percentage plus a fixed amount so that no sale can cost the platform money.
 * A payout has its own fixed cost, which is what payout-thresholds.ts amortises.
 *
 * A refund deletes the purchase row, so the debt disappears with it. That is only safe
 * while the sale has not been paid out yet, which is what the clearing window in
 * clearing.ts guarantees: a sale is not payable until it can no longer be reversed. A
 * balance can still go negative if a reversal arrives after the window, and is then carried
 * against the seller's next sale rather than written off.
 */
import { payoutThresholdCents, transferCostCents, type PayoutMethod } from './payout-thresholds.ts';
import { admin } from './supabase.ts';

export interface SellerBalance {
  sellerId: string;
  username: string | null;
  displayName: string | null;
  currency: string;
  /** List price of every settled sale. */
  grossCents: number;
  /** The platform's commission across those sales. */
  feeCents: number;
  /** What the seller has earned: gross minus commission. */
  earnedCents: number;
  paidCents: number;
  /** Earned minus paid. Everything owed, cleared or not. */
  outstandingCents: number;
  /** Past its clearing window, so safe to send. */
  clearedCents: number;
  /** Cleared minus paid: what could actually be transferred today. */
  availableCents: number;
  /** Still inside the buyer's reversal window. Owed, but not yet safe to send. */
  holdingCents: number;
  salesCount: number;
  /** What they must accrue before a transfer is worth making. Derived from their method. */
  thresholdCents: number;
  /** What sending it will cost the platform. Null until they say how to be paid. */
  transferFeeCents: number | null;
  /** Outstanding has reached the threshold and there is somewhere to send it. */
  payable: boolean;
  payout: {
    country: string;
    currency: string;
    method: string;
    accountName: string;
    accountRef: string;
    bankCode: string | null;
  } | null;
}

type Row = Record<string, any>;

/**
 * Every seller with either sales or payments, and what is outstanding for each.
 *
 * Purchases made before the seller was recorded on the row are skipped rather than guessed
 * at: an unattributable sale must not appear as someone's debt.
 */
export async function sellerBalances(): Promise<SellerBalance[]> {
  const db = admin();

  const [{ data: purchases, error: pErr }, { data: runs, error: rErr }] = await Promise.all([
    db.from('purchases').select('seller_id, amount_cents, fee_cents, clears_at').not('seller_id', 'is', null),
    db.from('seller_payout_runs').select('seller_id, amount_cents, currency'),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);

  const totals = new Map<string, { gross: number; fee: number; cleared: number; paid: number; sales: number }>();
  const get = (id: string) => {
    let t = totals.get(id);
    if (!t) totals.set(id, (t = { gross: 0, fee: 0, cleared: 0, paid: 0, sales: 0 }));
    return t;
  };

  const now = Date.now();
  for (const p of (purchases ?? []) as Row[]) {
    const t = get(p.seller_id);
    t.gross += p.amount_cents ?? 0;
    t.fee += p.fee_cents ?? 0;
    // No clears_at means the row predates the clearing window; its window has long passed.
    if (!p.clears_at || new Date(p.clears_at).getTime() <= now) t.cleared += (p.amount_cents ?? 0) - (p.fee_cents ?? 0);
    // Free claims are purchases too; they are not sales and should not inflate the count.
    if ((p.amount_cents ?? 0) > 0) t.sales++;
  }
  for (const r of (runs ?? []) as Row[]) get(r.seller_id).paid += r.amount_cents ?? 0;

  const ids = [...totals.keys()];
  if (!ids.length) return [];

  const [{ data: profiles }, { data: payouts }] = await Promise.all([
    db.from('profiles').select('id, username, display_name').in('id', ids),
    db.from('seller_payouts').select('*').in('user_id', ids),
  ]);
  const profileById = new Map((profiles ?? []).map((p: Row) => [p.id, p]));
  const payoutById = new Map((payouts ?? []).map((p: Row) => [p.user_id, p]));

  return ids
    .map((id) => {
      const t = totals.get(id)!;
      const profile = profileById.get(id);
      const d = payoutById.get(id);
      const earned = t.gross - t.fee;
      const outstanding = earned - t.paid;
      // Only cleared money may be sent; the rest is still inside a buyer's reversal window.
      const available = t.cleared - t.paid;
      const method = (d?.method ?? null) as PayoutMethod | null;
      const thresholdCents = payoutThresholdCents(method, d?.country ?? null);
      return {
        sellerId: id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? null,
        currency: d?.currency ?? 'INR',
        grossCents: t.gross,
        feeCents: t.fee,
        earnedCents: earned,
        paidCents: t.paid,
        outstandingCents: outstanding,
        clearedCents: t.cleared,
        availableCents: available,
        holdingCents: earned - t.cleared,
        salesCount: t.sales,
        thresholdCents,
        transferFeeCents: method ? transferCostCents(method, d?.country ?? '') : null,
        // Payable means both safe to send and worth the transfer fee.
        payable: !!d && available >= thresholdCents,
        payout: d
          ? {
              country: d.country,
              currency: d.currency,
              method: d.method,
              accountName: d.account_name,
              accountRef: d.account_ref,
              bankCode: d.bank_code ?? null,
            }
          : null,
      };
    })
    .sort((a, b) => b.outstandingCents - a.outstandingCents);
}

/** One seller's own view: earned, paid and outstanding, for the sell dashboard. */
export async function sellerBalance(sellerId: string): Promise<{
  earnedCents: number;
  paidCents: number;
  outstandingCents: number;
  availableCents: number;
  holdingCents: number;
  thresholdCents: number;
  payable: boolean;
}> {
  const db = admin();
  const [{ data: purchases, error: pErr }, { data: runs, error: rErr }] = await Promise.all([
    db.from('purchases').select('amount_cents, fee_cents, clears_at').eq('seller_id', sellerId),
    db.from('seller_payout_runs').select('amount_cents').eq('seller_id', sellerId),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);

  const now = Date.now();
  let earned = 0;
  let cleared = 0;
  for (const p of (purchases ?? []) as Row[]) {
    const net = (p.amount_cents ?? 0) - (p.fee_cents ?? 0);
    earned += net;
    // No clears_at means the row predates the clearing window; its window has long passed.
    if (!p.clears_at || new Date(p.clears_at).getTime() <= now) cleared += net;
  }
  const paid = (runs ?? []).reduce((s: number, r: Row) => s + (r.amount_cents ?? 0), 0);

  const { data: d } = await db.from('seller_payouts').select('method, country').eq('user_id', sellerId).maybeSingle();
  const thresholdCents = payoutThresholdCents((d?.method ?? null) as PayoutMethod | null, d?.country ?? null);
  const available = cleared - paid;
  return {
    earnedCents: earned,
    paidCents: paid,
    outstandingCents: earned - paid,
    availableCents: available,
    holdingCents: earned - cleared,
    thresholdCents,
    payable: !!d && available >= thresholdCents,
  };
}

export interface RecordPayoutInput {
  sellerId: string;
  amountCents: number;
  currency?: string;
  reference?: string | null;
  note?: string | null;
}

/**
 * Records a transfer that has already been made. Snapshots where it went, so editing the
 * payout details later cannot rewrite what happened.
 */
export async function recordPayout(input: RecordPayoutInput): Promise<Row> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error('Amount must be a positive whole number of minor units');
  const db = admin();
  const { data: d } = await db.from('seller_payouts').select('*').eq('user_id', input.sellerId).maybeSingle();

  const { data, error } = await db
    .from('seller_payout_runs')
    .insert({
      seller_id: input.sellerId,
      amount_cents: input.amountCents,
      currency: (input.currency ?? d?.currency ?? 'INR').toUpperCase(),
      method: d?.method ?? null,
      account_ref: d?.account_ref ?? null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function payoutHistory(sellerId: string): Promise<Row[]> {
  const { data, error } = await admin().from('seller_payout_runs').select('*').eq('seller_id', sellerId).order('paid_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Batch payment files want one row per seller, so this is the shape a bank or Wise expects. */
/**
 * The batch file an operator uploads to their bank.
 *
 * The amount is `availableCents`, not `outstandingCents`: only money past the buyer's
 * reversal window may be sent. Outstanding includes sales still inside that window, and a
 * bank file built on it would pay out money that can still be clawed back, which is the
 * exposure the clearing window exists to prevent.
 */
export function balancesToCsv(rows: SellerBalance[]): string {
  const head = ['seller_id', 'username', 'name', 'payable_minor_units', 'currency', 'country', 'method', 'account_name', 'account_ref', 'bank_code'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.sellerId,
      r.username,
      r.payout?.accountName ?? r.displayName,
      r.availableCents,
      r.payout?.currency ?? r.currency,
      r.payout?.country,
      r.payout?.method,
      r.payout?.accountName,
      r.payout?.accountRef,
      r.payout?.bankCode,
    ]
      .map(esc)
      .join(',')
  );
  return [head.join(','), ...lines].join('\n');
}
