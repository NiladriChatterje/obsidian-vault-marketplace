/**
 * POST /webhooks/razorpay
 * Second source of truth for payments: settles orders even if the buyer never
 * returned from the checkout page, and flips payouts_enabled when Razorpay
 * finishes reviewing a seller's Route linked account. Subscribe to
 * payment.captured, order.paid, payment.failed and product.route.activated /
 * under_review / needs_clarification, then set RAZORPAY_WEBHOOK_SECRET.
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO } from '../config.ts';
import { getOrder, markOrderFailed, settleOrder } from '../orders.ts';
import { verifyWebhookSignature } from '../razorpay.ts';
import { admin } from '../supabase.ts';

export default async function webhookRoutes(app: FastifyInstance) {
  // Keep the raw body: the signature is computed over the exact bytes Razorpay sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post<{ Body: string }>('/webhooks/razorpay', async (req, reply) => {
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !verifyWebhookSignature(req.body, signature)) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body) as { event: string; account_id?: string; payload?: Record<string, any> };

    // Route linked account reviewed. Checkout reads profiles.payouts_enabled to
    // decide whether a seller's paid vaults can be bought, and only the seller's
    // own page visits refresh it -- so without this their listings stay
    // unbuyable until they next open the app.
    if (event.event.startsWith('product.route.')) {
      // Linked accounts live in profiles, which only exists with Supabase configured.
      if (IS_DEMO) return { received: true, ignored: 'demo' };
      const product = event.payload?.merchant_product?.entity;
      const accountId = product?.account_id ?? event.account_id;
      if (!accountId) return { received: true, ignored: 'no account' };
      // Prefer the entity's current status; fall back to the event name.
      const activated = (product?.activation_status ?? event.event.replace('product.route.', '')) === 'activated';
      const { error } = await admin().from('profiles').update({ payouts_enabled: activated }).eq('razorpay_account_id', accountId);
      if (error) {
        req.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
      return { received: true };
    }

    const payment = event.payload?.payment?.entity;
    const orderId: string | undefined = payment?.order_id ?? event.payload?.order?.entity?.id;
    if (!orderId) return { received: true, ignored: 'no order' };

    const order = await getOrder(orderId);
    if (!order) return { received: true, ignored: 'unknown order' };

    switch (event.event) {
      case 'payment.captured':
      case 'order.paid': {
        if (!payment?.id) break;
        try {
          await settleOrder(order, payment.id, null);
        } catch (e) {
          req.log.error(e);
          // Non-2xx makes Razorpay retry later.
          return reply.code(500).send({ error: e instanceof Error ? e.message : 'settle failed' });
        }
        break;
      }
      case 'payment.failed':
        await markOrderFailed(orderId);
        break;
      default:
        break;
    }
    return { received: true };
  });
}
