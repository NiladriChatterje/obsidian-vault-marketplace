/**
 * POST /webhooks/razorpay
 * Second source of truth for Razorpay payments: settles orders even if the buyer never
 * returned from the checkout page. Subscribe to payment.captured, order.paid,
 * payment.failed, refund.created and refund.processed, then set RAZORPAY_WEBHOOK_SECRET.
 *
 * Dodo has its own endpoint next door in routes/dodo.ts; it signs differently and is the
 * only way a Dodo purchase is ever granted.
 */
import type { FastifyInstance } from 'fastify';
import { getOrder, getOrderByPayment, markOrderFailed, refundOrder, settleOrder } from '../orders.ts';
import { verifyWebhookSignature } from '../razorpay.ts';

export default async function webhookRoutes(app: FastifyInstance) {
  // Keep the raw body: the signature is computed over the exact bytes Razorpay sent.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post<{ Body: string }>('/webhooks/razorpay', async (req, reply) => {
    const signature = req.headers['x-razorpay-signature'];
    if (typeof signature !== 'string' || !verifyWebhookSignature(req.body, signature)) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body) as { event: string; account_id?: string; payload?: Record<string, any> };

    const payment = event.payload?.payment?.entity;
    const orderId: string | undefined = payment?.order_id ?? event.payload?.order?.entity?.id;
    // Refund events carry the payment, not the order, so fall back to that.
    const refundPaymentId: string | undefined = event.payload?.refund?.entity?.payment_id;
    if (!orderId && !refundPaymentId) return { received: true, ignored: 'no order' };

    const order = orderId ? await getOrder(orderId) : await getOrderByPayment(refundPaymentId!);
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
        await markOrderFailed(order.providerOrderId);
        break;
      case 'refund.created':
      case 'refund.processed': {
        // With Route the seller's share is already out of the platform balance, so the
        // refund has to be matched by a reversal or the platform absorbs it.
        const refund = event.payload?.refund?.entity;
        if (!refund?.amount) break;
        try {
          await refundOrder(order, Number(refund.amount));
        } catch (e) {
          req.log.error(e);
          return reply.code(500).send({ error: e instanceof Error ? e.message : 'refund handling failed' });
        }
        break;
      }
      default:
        break;
    }
    return { received: true };
  });
}
