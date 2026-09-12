/**
 * Paying sellers. Platform-operator endpoints, not seller-facing.
 *
 *   GET  /admin/payouts            what is owed to whom, most owed first
 *   GET  /admin/payouts.csv        the same as a batch payment file
 *   POST /admin/payouts            record a transfer you have made
 *   GET  /admin/payouts/:sellerId  one seller's payment history
 *
 * Gated on ADMIN_USER_IDS, a comma-separated list of Supabase user ids. With it unset every
 * route here is closed: an admin surface that defaults to open because a variable was
 * forgotten is worse than one that is unavailable until configured.
 *
 * These endpoints record money that moved elsewhere. Nothing here sends a payment.
 */
import type { FastifyInstance } from 'fastify';
import { cfg } from '../config.ts';
import { balancesToCsv, payoutHistory, recordPayout, sellerBalances } from '../payout-ledger.ts';
import { userFromRequest } from '../supabase.ts';

export default async function adminPayoutRoutes(app: FastifyInstance) {
  /** Resolves the caller and refuses anyone not named in ADMIN_USER_IDS. */
  const requireAdmin = async (req: Parameters<typeof userFromRequest>[0], reply: { code: (c: number) => { send: (b: unknown) => unknown } }) => {
    if (!cfg.adminUserIds.length) {
      reply.code(503).send({ error: 'Admin payouts are not enabled. Set ADMIN_USER_IDS on the server.' });
      return null;
    }
    const user = await userFromRequest(req);
    if (!user) {
      reply.code(401).send({ error: 'Not signed in' });
      return null;
    }
    if (!cfg.adminUserIds.includes(user.id)) {
      reply.code(403).send({ error: 'Not an administrator' });
      return null;
    }
    return user;
  };

  app.get('/admin/payouts', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = await sellerBalances();
    const owed = rows.filter((r) => r.outstandingCents > 0);
    // Below its threshold a balance is still owed, just not yet worth a transfer: sending it
    // would cost more than the sales behind it earned.
    const payable = owed.filter((r) => r.payable);
    const accruing = owed.filter((r) => r.payout && !r.payable);
    return {
      sellers: rows,
      totalOutstandingCents: owed.reduce((s, r) => s + r.outstandingCents, 0),
      payableNowCents: payable.reduce((s, r) => s + r.outstandingCents, 0),
      payableCount: payable.length,
      accruingCount: accruing.length,
      // Owed money with nowhere to send it. Publishing a paid vault is gated on payout
      // details, so this means a seller removed them after going live.
      missingDetailsCount: owed.filter((r) => !r.payout).length,
    };
  });

  app.get('/admin/payouts.csv', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    // Only sellers worth paying today; the rest keep accruing.
    const rows = (await sellerBalances()).filter((r) => r.payable);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="payouts-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(balancesToCsv(rows));
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
