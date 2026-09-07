/**
 * POST /webhooks/razorpay
 * Second source of truth for payments: settles orders even if the buyer never
 * returned from the checkout page. Subscribe to payment.captured, order.paid,
 * payment.failed in the Razorpay dashboard and set RAZORPAY_WEBHOOK_SECRET.
 */
import type { FastifyInstance } from 'fastify';
import { getOrder, markOrderFailed, settleOrder } from '../orders.ts';
import { verifyWebhookSignature } from '../razorpay.ts';

export default async function webhookRoutes(app: FastifyInstance) {
  // Keep the raw body: the signature is computed over the exact bytes Razorpay sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post<{ Body: string }>('/webhooks/razorpay', async (req, reply) => {
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !verifyWebhookSignature(req.body, signature)) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body) as { event: string; payload?: Record<string, any> };
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
