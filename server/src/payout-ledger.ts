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
import { cfg } from './config.ts';
import { payoutThresholdCents, transferCostCents, type PayoutMethod } from './payout-thresholds.ts';
import { admin } from './supabase.ts';

export interface SellerBalance {
  sellerId: string;
  username: string | null;
  displayName: string | null;
  /** What every amount below is in: the platform's currency, which every listing is priced in. */
  currency: string;
  /** List price of every settled sale. */
  grossCents: number;
  /** The platform's commission across those sales. */
  feeCents: number;
  /** What the seller has earned: gross minus commission. */
  earnedCents: number;
  paidCents: number;
  /**
   * Promised by a prepared run that has not been confirmed. Still owed, but already spoken
   * for, so it is subtracted from what a fresh run may promise again.
   */
  pendingCents: number;
  /** Earned minus paid. Everything owed, cleared or not. */
  outstandingCents: number;
  /** Past its clearing window, so safe to send. */
  clearedCents: number;
  /** Cleared minus paid: what could actually be transferred today. */
  availableCents: number;
  /** Not yet cleared: inside the buyer's reversal window, or not yet settled to us by Dodo. */
  holdingCents: number;
  /**
   * Past the buyer's window but Dodo has not paid us for it yet. Owed and safe from
   * reversal, but not yet ours to send: paying it would be lending the seller our money.
   */
  unsettledCents: number;
  salesCount: number;
  /** What they must accrue before a transfer is worth making. Derived from their method. */
  thresholdCents: number;
  /** What sending it will cost the platform. Null until they say how to be paid. */
  transferFeeCents: number | null;
  /** Outstanding has reached the threshold and there is somewhere to send it. */
  payable: boolean;
  payout: {
    country: string;
    /** What they asked to receive. The transfer converts into it; nothing here is in it. */
    currency: string;
    method: string;
    accountName: string;
    accountRef: string;
    bankCode: string | null;
  } | null;
}

type Row = Record<string, any>;

/**
 * Whether a sale may be paid on. Two things have to be true: the buyer can no longer
 * reverse it, and Dodo has settled it to us. The first protects against a refund landing on
 * money already sent; the second against sending money we have not yet received.
 *
 * No clears_at means the row predates the clearing window; its window has long passed.
 */
function saleCleared(p: Row, now: number): boolean {
  const pastWindow = !p.clears_at || new Date(p.clears_at).getTime() <= now;
  return pastWindow && (!cfg.payoutRequireSettlement || !!p.settled_at);
}

/** Past the buyer's window, so only the settlement is outstanding. */
function saleAwaitingSettlement(p: Row, now: number): boolean {
  const pastWindow = !p.clears_at || new Date(p.clears_at).getTime() <= now;
  return pastWindow && cfg.payoutRequireSettlement && !p.settled_at;
}

/**
 * Every seller with either sales or payments, and what is outstanding for each.
 *
 * Purchases made before the seller was recorded on the row are skipped rather than guessed
 * at: an unattributable sale must not appear as someone's debt.
 */
export async function sellerBalances(): Promise<SellerBalance[]> {
  const db = admin();

  const [{ data: purchases, error: pErr }, { data: runs, error: rErr }] = await Promise.all([
    db.from('purchases').select('seller_id, amount_cents, fee_cents, clears_at, settled_at').not('seller_id', 'is', null),
    db.from('seller_payout_runs').select('seller_id, amount_cents, currency, status'),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);

  const totals = new Map<string, { gross: number; fee: number; cleared: number; unsettled: number; paid: number; pending: number; sales: number }>();
  const get = (id: string) => {
    let t = totals.get(id);
    if (!t) totals.set(id, (t = { gross: 0, fee: 0, cleared: 0, unsettled: 0, paid: 0, pending: 0, sales: 0 }));
    return t;
  };

  const now = Date.now();
  for (const p of (purchases ?? []) as Row[]) {
    const t = get(p.seller_id);
    t.gross += p.amount_cents ?? 0;
    t.fee += p.fee_cents ?? 0;
    const net = (p.amount_cents ?? 0) - (p.fee_cents ?? 0);
    if (saleCleared(p, now)) t.cleared += net;
    else if (saleAwaitingSettlement(p, now)) t.unsettled += net;
    // Free claims are purchases too; they are not sales and should not inflate the count.
    if ((p.amount_cents ?? 0) > 0) t.sales++;
  }
  for (const r of (runs ?? []) as Row[]) {
    const t = get(r.seller_id);
    // A cancelled run neither moved money nor promises any, so it counts for nothing.
    if (r.status === 'paid') t.paid += r.amount_cents ?? 0;
    else if (r.status === 'pending') t.pending += r.amount_cents ?? 0;
  }

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
      // Pending comes off too: it is already promised by a run awaiting confirmation, and
      // counting it again would prepare a second run for money sent once.
      const available = t.cleared - t.paid - t.pending;
      const method = (d?.method ?? null) as PayoutMethod | null;
      const thresholdCents = payoutThresholdCents(method, d?.country ?? null);
      return {
        sellerId: id,
        username: profile?.username ?? null,
        displayName: profile?.display_name ?? null,
        currency: cfg.platformCurrency,
        grossCents: t.gross,
        feeCents: t.fee,
        earnedCents: earned,
        paidCents: t.paid,
        pendingCents: t.pending,
        outstandingCents: outstanding,
        clearedCents: t.cleared,
        availableCents: available,
        holdingCents: earned - t.cleared,
        unsettledCents: t.unsettled,
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
  pendingCents: number;
  outstandingCents: number;
  availableCents: number;
  holdingCents: number;
  thresholdCents: number;
  payable: boolean;
}> {
  const db = admin();
  const [{ data: purchases, error: pErr }, { data: runs, error: rErr }] = await Promise.all([
    db.from('purchases').select('amount_cents, fee_cents, clears_at, settled_at').eq('seller_id', sellerId),
    db.from('seller_payout_runs').select('amount_cents, status').eq('seller_id', sellerId),
  ]);
  if (pErr) throw new Error(pErr.message);
  if (rErr) throw new Error(rErr.message);

  const now = Date.now();
  let earned = 0;
  let cleared = 0;
  for (const p of (purchases ?? []) as Row[]) {
    const net = (p.amount_cents ?? 0) - (p.fee_cents ?? 0);
    earned += net;
    if (saleCleared(p, now)) cleared += net;
  }
  // Only a confirmed run is money the seller has. Pending is promised but not sent, and a
  // cancelled one never happened; showing either as paid would tell a seller they had been
  // paid money that is still sitting here.
  const rows = (runs ?? []) as Row[];
  const sumWhere = (status: string) => rows.filter((r) => r.status === status).reduce((n, r) => n + (r.amount_cents ?? 0), 0);
  const paid = sumWhere('paid');
  const pending = sumWhere('pending');

  const { data: d } = await db.from('seller_payouts').select('method, country').eq('user_id', sellerId).maybeSingle();
  const thresholdCents = payoutThresholdCents((d?.method ?? null) as PayoutMethod | null, d?.country ?? null);
  const available = cleared - paid - pending;
  return {
    earnedCents: earned,
    paidCents: paid,
    pendingCents: pending,
    outstandingCents: earned - paid,
    availableCents: available,
    holdingCents: earned - cleared,
    thresholdCents,
    payable: !!d && available >= thresholdCents,
  };
}

export interface RecordPayoutInput {
  sellerId: string;
  /** In the platform's currency: what left the account, not what the seller received. */
  amountCents: number;
  /** Optional, and only accepted if it names the platform's currency. */
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
  // The ledger is kept in one currency. An amount in any other would be subtracted from a
  // balance as though it were that one, so it is refused rather than converted or trusted.
  const currency = (input.currency ?? cfg.platformCurrency).toUpperCase();
  if (currency !== cfg.platformCurrency) {
    throw new Error(`Record the ${cfg.platformCurrency} amount that left the account. What the seller received in ${currency} belongs in the note.`);
  }
  const db = admin();
  const { data: d } = await db.from('seller_payouts').select('*').eq('user_id', input.sellerId).maybeSingle();

  const { data, error } = await db
    .from('seller_payout_runs')
    .insert({
      seller_id: input.sellerId,
      amount_cents: input.amountCents,
      currency,
      payout_currency: d?.currency ?? null,
      method: d?.method ?? null,
      account_ref: d?.account_ref ?? null,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      // Recorded after the fact, so it is paid the moment it is written. paid_at no longer
      // defaults, because a prepared run has not been paid at any time.
      status: 'paid',
      paid_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Writes a `pending` run for every seller whose balance has cleared its region's window and
 * is worth the transfer fee. This is the step that stops a cleared balance being forgotten:
 * once a run exists the debt is recorded as an instruction, not left implicit in a table
 * nobody reads.
 *
 * It does not move money. Nothing here can: Dodo is the merchant of record and settles only
 * to the platform, so the transfer itself is made by the operator (or, one day, by a payout
 * rail) and confirmed afterwards with confirmPayoutRun.
 *
 * Safe to run on a timer. `payable` already excludes anyone with a pending run, since
 * balances subtract pending from available, and a unique index allows one pending run per
 * seller, so a double fire cannot promise the same money twice.
 */
export async function preparePayoutRuns(): Promise<Row[]> {
  const due = (await sellerBalances()).filter((r) => r.payable && r.availableCents > 0);
  if (!due.length) return [];

  const prepared: Row[] = [];
  for (const r of due) {
    const { data, error } = await admin()
      .from('seller_payout_runs')
      .insert({
        seller_id: r.sellerId,
        amount_cents: r.availableCents,
        // A sum of listing prices, so in the platform's currency. What the seller receives
        // is a separate instruction: convert into this on the way.
        currency: r.currency,
        payout_currency: r.payout?.currency ?? null,
        method: r.payout?.method ?? null,
        account_ref: r.payout?.accountRef ?? null,
        status: 'pending',
        paid_at: null,
      })
      .select('*')
      .single();
    // A seller who already has one is not an error: the index is doing its job.
    if (error) {
      if (error.code === '23505') continue;
      throw new Error(error.message);
    }
    prepared.push(data);
  }
  return prepared;
}

/** Runs awaiting confirmation, oldest first: the ones that have been waiting longest. */
export async function pendingPayoutRuns(): Promise<Row[]> {
  const { data, error } = await admin()
    .from('seller_payout_runs')
    // The seller's name comes along so a work list reads as people, not uuids.
    .select('*, profiles(username, display_name)')
    .eq('status', 'pending')
    .order('prepared_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Marks a prepared run as actually transferred. Only now does the amount count against the
 * seller's balance, because only now has it left the platform's account.
 */
export async function confirmPayoutRun(id: string, reference?: string | null, note?: string | null): Promise<Row> {
  const patch: Row = { status: 'paid', paid_at: new Date().toISOString() };
  if (reference !== undefined) patch.reference = reference?.trim() || null;
  if (note !== undefined) patch.note = note?.trim() || null;

  const { data, error } = await admin()
    .from('seller_payout_runs')
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No pending payout run with that id. It may already be confirmed or cancelled.');
  return data;
}

/**
 * Abandons a prepared run without paying it. The balance returns to available and will be
 * prepared again on the next pass, which is what should happen when a transfer failed.
 */
export async function cancelPayoutRun(id: string, note?: string | null): Promise<Row> {
  const patch: Row = { status: 'cancelled' };
  if (note !== undefined) patch.note = note?.trim() || null;

  const { data, error } = await admin()
    .from('seller_payout_runs')
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No pending payout run with that id.');
  return data;
}

export async function payoutHistory(sellerId: string): Promise<Row[]> {
  const { data, error } = await admin().from('seller_payout_runs').select('*').eq('seller_id', sellerId).order('paid_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Batch payment files want one row per seller, so this is the shape a bank or Wise expects. */
/**
 * The batch file for a set of prepared runs: one line per transfer to make.
 *
 * This, not the balance list, is what an operator uploads to their bank. A prepared run is
 * a fixed amount decided at preparation time, so the file cannot drift while it is being
 * acted on, and confirming the runs afterwards matches the file line for line.
 */
export function runsToCsv(runs: Row[]): string {
  // `currency` is what the amount is in; `pay_in` is what the seller receives. A bank or
  // Wise batch takes exactly that pair: a source amount, and a target currency to convert to.
  const head = ['run_id', 'seller_id', 'name', 'amount_minor_units', 'currency', 'pay_in', 'method', 'account_ref', 'prepared_at'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = runs.map((r) =>
    [r.id, r.seller_id, r.profiles?.display_name ?? r.profiles?.username, r.amount_cents, r.currency, r.payout_currency ?? r.currency, r.method, r.account_ref, r.prepared_at]
      .map(esc)
      .join(',')
  );
  return [head.join(','), ...lines].join('\n');
}

/**
 * The batch file an operator uploads to their bank.
 *
 * The amount is `availableCents`, not `outstandingCents`: only money past the buyer's
 * reversal window may be sent. Outstanding includes sales still inside that window, and a
 * bank file built on it would pay out money that can still be clawed back, which is the
 * exposure the clearing window exists to prevent.
 */
export function balancesToCsv(rows: SellerBalance[]): string {
  const head = ['seller_id', 'username', 'name', 'payable_minor_units', 'currency', 'pay_in', 'country', 'method', 'account_name', 'account_ref', 'bank_code'];
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
      r.currency,
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
