/**
 * When Dodo has actually paid us for a sale.
 *
 * Dodo settles to the platform on its own schedule, twice a month and only once the
 * balance passes its floor, so a sale is money at Dodo long before it is money in the bank.
 * A seller's share sent before then is sent from the platform's own pocket, and at low
 * volume, where the balance can sit under Dodo's floor for months, that is not a small loan.
 *
 * So a sale is not payable until Dodo has settled it. Each Dodo payout carries a breakup of
 * the ledger entries it was made up of, one per payment, so the sales in it are marked
 * exactly rather than guessed at from dates.
 *
 * Two routes in, so a missed webhook cannot hold a seller's money forever: Dodo's
 * payout.success webhook marks a payout as it lands, and the daily payout check walks
 * Dodo's payout list and settles anything the webhook did not reach.
 */
import { DODO_ENABLED, dodo } from './dodo.ts';
import { admin } from './supabase.ts';

type Row = Record<string, any>;

/** The fields a payout carries whether it arrives by webhook or by listing. */
export interface DodoPayoutLike {
  payout_id: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

/** Remembers a payout Dodo told us about, whatever its status. Idempotent. */
export async function recordDodoPayout(p: DodoPayoutLike): Promise<void> {
  const { error } = await admin()
    .from('dodo_payouts')
    .upsert(
      { payout_id: p.payout_id, amount: p.amount, currency: p.currency, status: p.status, created_at: p.created_at },
      { onConflict: 'payout_id' }
    );
  if (error) throw new Error(error.message);
}

/**
 * Marks every sale a successful payout contained as settled, and returns how many. Safe to
 * call again: a sale already settled is left alone, whichever payout marked it.
 */
export async function settleDodoPayout(payoutId: string): Promise<number> {
  const db = admin();

  const paymentIds: string[] = [];
  for await (const entry of dodo().payouts.breakup.details.list(payoutId, { page_size: 100 })) {
    if (entry.event_type === 'payment' && entry.reference_object_id) paymentIds.push(entry.reference_object_id);
  }

  const now = new Date().toISOString();
  let marked = 0;
  // Chunked so a payout of a thousand sales does not become one enormous IN clause.
  for (let i = 0; i < paymentIds.length; i += 200) {
    const { data, error } = await db
      .from('purchases')
      .update({ settled_at: now, dodo_payout_id: payoutId })
      .in('provider_payment_id', paymentIds.slice(i, i + 200))
      .is('settled_at', null)
      .select('id');
    if (error) throw new Error(error.message);
    marked += data?.length ?? 0;
  }

  const { error } = await db
    .from('dodo_payouts')
    .update({ status: 'success', settled_at: now, purchases_marked: marked })
    .eq('payout_id', payoutId);
  if (error) throw new Error(error.message);
  return marked;
}

/**
 * Walks Dodo's payouts and settles any successful one not yet applied. The webhook does
 * this as payouts land; this is for the ones it missed, and for the first run after this
 * was introduced, which has every earlier payout to catch up on.
 */
export async function reconcileDodoPayouts(): Promise<{ payouts: number; purchases: number }> {
  if (!DODO_ENABLED) return { payouts: 0, purchases: 0 };
  const db = admin();

  const { data: known, error } = await db.from('dodo_payouts').select('payout_id').not('settled_at', 'is', null);
  if (error) throw new Error(error.message);
  const applied = new Set((known ?? []).map((r: Row) => r.payout_id));

  let payouts = 0;
  let purchases = 0;
  for await (const p of dodo().payouts.list({ page_size: 100 })) {
    await recordDodoPayout(p);
    if (p.status !== 'success' || applied.has(p.payout_id)) continue;
    purchases += await settleDodoPayout(p.payout_id);
    payouts++;
  }
  return { payouts, purchases };
}
