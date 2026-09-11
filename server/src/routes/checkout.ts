/**
 * Checkout, server side. Dodo Payments is the merchant of record and hosts the payment
 * page itself, so this only opens a session and hands back its url. Nothing is split to
 * anyone: the platform is the seller, and creators are paid outside the checkout.
 *
 *   POST /checkout                 open a Dodo checkout session for a vault -> { url, orderId, ... }
 *   GET  /checkout/:orderId/status { status, paymentId } for polling
 *
 * The purchase is granted by POST /webhooks/dodo and never here - the buyer's return to
 * /checkout-result is a navigation they can close or replay.
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO, platformFee } from '../config.ts';
import { DODO_ENABLED, dodo, dodoError, productForVault } from '../dodo.ts';
import { getOrder, saveOrder, type Order } from '../orders.ts';
import { hasPayoutDetails } from '../seller-payouts.ts';
import { resolveReturnOrigin, returnUrl } from '../redirect.ts';
import { admin, userFromRequest } from '../supabase.ts';
import { SANITY_ENABLED, getVault } from '../sanity/index.ts';
import type { Vault } from '../types.ts';

interface CheckoutBody {
  vaultId: string;
  redirectOrigin?: string;
  /** Demo mode only: the client describes the vault because there is no database. */
  demo?: { amountCents: number; currency?: string; title: string };
}

type Row = Record<string, any>;

export default async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Body: CheckoutBody }>(
    '/checkout',
    {
      schema: {
        body: {
          type: 'object',
          required: ['vaultId'],
          properties: {
            vaultId: { type: 'string', minLength: 1 },
            redirectOrigin: { type: 'string' },
            demo: {
              type: 'object',
              required: ['amountCents', 'title'],
              properties: { amountCents: { type: 'integer', minimum: 100 }, currency: { type: 'string' }, title: { type: 'string' } },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const { vaultId, demo } = req.body;
      const returnOrigin = resolveReturnOrigin(req.body.redirectOrigin);

      let order: Omit<Order, 'provider' | 'providerOrderId' | 'status' | 'paymentId' | 'signature'>;
      let vault: Vault | null = null;

      if (IS_DEMO) {
        if (!demo) return reply.code(400).send({ error: 'Demo checkout needs amountCents and title' });
        order = {
          vaultId,
          sellerId: null,
          buyerId: null,
          buyerEmail: null,
          title: demo.title,
          amount: demo.amountCents,
          currency: (demo.currency ?? 'INR').toUpperCase(),
          fee: platformFee(demo.amountCents),
          returnOrigin,
        };
      } else {
        const user = await userFromRequest(req);
        if (!user) return reply.code(401).send({ error: 'Not signed in' });

        if (!SANITY_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured' });
        const v = await getVault(vaultId);
        if (!v) return reply.code(404).send({ error: 'Vault not found' });
        if (v.status !== 'published') return reply.code(400).send({ error: 'Vault is not available' });
        if (v.priceCents <= 0) return reply.code(400).send({ error: 'This vault is free; claim it instead' });
        if (v.sellerId === user.id) return reply.code(400).send({ error: 'You already own this vault' });

        const { data: owned } = await admin().from('purchases').select('id').eq('vault_id', vaultId).eq('buyer_id', user.id).maybeSingle();
        if (owned) return reply.code(400).send({ error: 'You already own this vault' });

        // Last line of defence. Publishing already requires this, but a seller could have
        // gone live and then had their details removed, and taking money we cannot pass on
        // is worse than refusing the sale.
        if (!(await hasPayoutDetails(v.sellerId))) {
          return reply.code(400).send({ error: 'This vault is temporarily unavailable: the seller has not finished their payout setup.' });
        }

        vault = v;
        order = {
          vaultId: v.id,
          sellerId: v.sellerId,
          buyerId: user.id,
          buyerEmail: user.email,
          title: v.title,
          amount: v.priceCents,
          currency: v.currency.toUpperCase(),
          fee: platformFee(v.priceCents),
          returnOrigin,
        };
      }

      if (!DODO_ENABLED) return reply.code(501).send({ error: 'Payments are not configured (DODO_API_KEY).' });
      if (IS_DEMO || !vault) return reply.code(501).send({ error: 'Paid checkout needs Supabase and the catalog configured.' });

      // Dodo hosts the payment page, so the buyer leaves for it and comes back to
      // /checkout-result. That return only reports the outcome; the webhook grants it.
      try {
        const session = await dodo().checkoutSessions.create({
          product_cart: [{ product_id: await productForVault(vault), quantity: 1 }],
          customer: order.buyerEmail ? { email: order.buyerEmail, name: order.buyerEmail.split('@')[0] } : undefined,
          return_url: returnUrl(returnOrigin, '/checkout-result', { status: 'success', vault: order.vaultId }),
          metadata: { vault_id: order.vaultId, buyer_id: order.buyerId ?? '' },
        });
        if (!session.checkout_url) throw new Error('Dodo returned no checkout url');
        await saveOrder({ ...order, provider: 'dodo', providerOrderId: session.session_id, status: 'created', paymentId: null, signature: null });
        return { url: session.checkout_url, orderId: session.session_id, amount: order.amount, currency: order.currency };
      } catch (e) {
        req.log.error(e);
        return reply.code(502).send({ error: dodoError(e) });
      }
    }
  );

  app.get<{ Params: { orderId: string } }>('/checkout/:orderId/status', async (req, reply) => {
    const order = await getOrder(req.params.orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return { status: order.status, provider: order.provider, paymentId: order.paymentId, vaultId: order.vaultId };
  });
}
