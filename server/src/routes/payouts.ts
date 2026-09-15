/**
 * The seller's own payout details, held by the platform.
 *
 *   GET /me/payout-details  -> { details, currencies } (details is null until they set it)
 *   PUT /me/payout-details  { details } -> { details }
 *
 * This is not an onboarding to the payment provider. Dodo is the merchant of record: it
 * settles one amount to the platform and never pays a seller, so these are the platform's
 * records of where each creator's share is sent, and nothing here leaves the server.
 */
import type { FastifyInstance } from 'fastify';
import { requireRequester } from '../access.ts';
import { IS_DEMO } from '../config.ts';
import { PAYOUT_CURRENCIES, suggestedCurrency } from '../payout-currencies.ts';
import { getPayoutDetails, savePayoutDetails, validatePayoutDetails, type PayoutDetails } from '../seller-payouts.ts';

export default async function payoutRoutes(app: FastifyInstance) {
  app.get('/me/payout-details', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    // The currencies ride along so the form offers only what can actually be paid out.
    if (IS_DEMO) return { details: null, currencies: PAYOUT_CURRENCIES, demo: true };
    return { details: await getPayoutDetails(r.id), currencies: PAYOUT_CURRENCIES };
  });

  app.put<{ Body: { details: PayoutDetails } }>(
    '/me/payout-details',
    { schema: { body: { type: 'object', required: ['details'], properties: { details: { type: 'object' } } } } },
    async (req, reply) => {
      const r = await requireRequester(req, reply);
      if (!r) return;
      if (IS_DEMO) return reply.code(501).send({ error: 'Payout details need Supabase configured on the server' });

      const problem = validatePayoutDetails(req.body.details);
      if (problem) return reply.code(400).send({ error: problem });

      try {
        return { details: await savePayoutDetails(r.id, req.body.details) };
      } catch (e) {
        req.log.error(e);
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'Could not save payout details' });
      }
    }
  );

  /** Prefill only; the seller can still choose another currency they can receive. */
  app.get<{ Params: { country: string } }>('/payout-currency/:country', async (req) => {
    return { currency: suggestedCurrency(req.params.country) };
  });
}
