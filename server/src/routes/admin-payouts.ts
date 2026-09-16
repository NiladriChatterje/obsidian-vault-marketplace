/**
 * Paying sellers. Platform-operator endpoints, not seller-facing.
 *
 *   GET  /admin/payouts            what is owed to whom, most owed first
 *   GET  /admin/payouts.csv        the same as a batch payment file
 *   POST /admin/payouts            record a transfer you have made
 *   GET  /admin/payouts/:sellerId  one seller's payment history
 *   GET  /admin/payouts/runs       runs prepared and awaiting a transfer
 *   POST /admin/payouts/runs       prepare this cycle's runs now; { asOfNow: true } batches today's balances instead
 *   POST /admin/payouts/runs/:id/confirm  { reference } the transfer has been made
 *   POST /admin/payouts/runs/:id/cancel   it has not, and will not be
 *
 * Gated on ADMIN_USER_IDS, a comma-separated list of Supabase user ids. With it unset every
 * route here is closed: an admin surface that defaults to open because a variable was
 * forgotten is worse than one that is unavailable until configured.
 *
 * These endpoints record money that moved elsewhere. Nothing here sends a payment.
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../admin.ts';
import { payoutCycle } from '../payout-cycle.ts';
import { cancelPayoutRun, confirmPayoutRun, payoutHistory, pendingPayoutRuns, preparePayoutRuns, recordPayout, runsToCsv, sellerBalances } from '../payout-ledger.ts';

export default async function adminPayoutRoutes(app: FastifyInstance) {
  app.get('/admin/payouts', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await sellerBalances();
    const owed = rows.filter((r) => r.outstandingCents > 0);
    // Below its threshold a balance is still owed, just not yet worth a transfer: sending it
    // would cost more than the sales behind it earned.
    const payable = owed.filter((r) => r.payable);
    const accruing = owed.filter((r) => r.payout && !r.payable);
    const cycle = payoutCycle();
    return {
      sellers: rows,
      // Payouts go out monthly; the balances above are live, the batch is cut on this day.
      cycle: { day: cycle.day, timeZone: cycle.timeZone, lastPayoutAt: cycle.current.toISOString(), nextPayoutAt: cycle.next.toISOString() },
      totalOutstandingCents: owed.reduce((s, r) => s + r.outstandingCents, 0),
      payableNowCents: payable.reduce((s, r) => s + r.availableCents, 0),
      // Owed, but still inside a buyer's reversal window or not yet settled to us by Dodo.
      holdingCents: owed.reduce((s, r) => s + r.holdingCents, 0),
      // The part of that which only waits on Dodo paying us: safe from reversal, not yet ours.
      unsettledCents: owed.reduce((s, r) => s + r.unsettledCents, 0),
      payableCount: payable.length,
      accruingCount: accruing.length,
      // Owed money with nowhere to send it. Publishing a paid vault is gated on payout
      // details, so this means a seller removed them after going live.
      missingDetailsCount: owed.filter((r) => !r.payout).length,
    };
  });

  /**
   * The work list: what has cleared, is worth sending, and is waiting on a transfer. The
   * scheduled watcher writes these; this is the same list it mails.
   */
  app.get('/admin/payouts/runs', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const runs = await pendingPayoutRuns();
    return {
      runs,
      count: runs.length,
      // Per currency: sellers are paid in their own, so one total would mean nothing.
      totals: runs.reduce<Record<string, number>>((acc, r) => {
        acc[r.currency] = (acc[r.currency] ?? 0) + r.amount_cents;
        return acc;
      }, {}),
    };
  });

  /**
   * Prepares runs on demand. The timer does this daily from the current payout day's
   * balances; this is for doing it now. `asOfNow` cuts a batch from today's balances
   * instead, for an operator who has decided to pay early and knows what that includes.
   */
  app.post<{ Body?: { asOfNow?: boolean } }>('/admin/payouts/runs', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const prepared = await preparePayoutRuns(req.body?.asOfNow ? new Date() : undefined);
    return { prepared, count: prepared.length };
  });

  app.post<{ Params: { id: string }; Body: { reference?: string; note?: string } }>(
    '/admin/payouts/runs/:id/confirm',
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      try {
        return { run: await confirmPayoutRun(req.params.id, req.body?.reference, req.body?.note) };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not confirm the run' });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: { note?: string } }>('/admin/payouts/runs/:id/cancel', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    try {
      return { run: await cancelPayoutRun(req.params.id, req.body?.note) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not cancel the run' });
    }
  });

  /**
   * The batch file, built from prepared runs rather than live balances. Preparing a run
   * fixes the amount, so the file cannot change underneath an operator midway through
   * paying it, and each line confirms back to exactly one run.
   *
   * Runs are prepared first if the timer has not got to it yet, so asking for the file is
   * always enough on its own.
   */
  app.get('/admin/payouts.csv', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    await preparePayoutRuns();
    const runs = await pendingPayoutRuns();
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="payouts-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(runsToCsv(runs));
  });

  app.post<{ Body: { sellerId: string; amountCents: number; currency?: string; reference?: string; note?: string } }>(
    '/admin/payouts',
    {
      schema: {
        body: {
          type: 'object',
          required: ['sellerId', 'amountCents'],
          properties: {
            sellerId: { type: 'string', minLength: 1 },
            amountCents: { type: 'integer', minimum: 1 },
            currency: { type: 'string' },
            reference: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      if (!(await requireAdmin(req, reply))) return;
      try {
        return { payout: await recordPayout(req.body) };
      } catch (e) {
        req.log.error(e);
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'Could not record the payout' });
      }
    }
  );

  app.get<{ Params: { sellerId: string } }>('/admin/payouts/:sellerId', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return { payouts: await payoutHistory(req.params.sellerId) };
  });
}
