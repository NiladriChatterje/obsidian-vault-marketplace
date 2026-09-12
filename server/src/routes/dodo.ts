/**
 * POST /webhooks/dodo
 *
 * The only way a Dodo purchase is ever granted. Dodo's own guidance is to fulfil on the
 * webhook and never on the browser redirect: the redirect is a navigation the buyer can
 * close, refuse or replay, while the webhook retries until it gets a 2xx.
 *
 * Signed with Standard Webhooks — HMAC over `id.timestamp.body` — so the raw body has to
 * reach the verifier byte for byte. Its own plugin scope keeps that parser off every other
 * route.
 *
 * Configure at Dodo → Developer → Webhooks with events payment.succeeded, payment.failed,
 * refund.succeeded, dispute.lost and payout.success, and put the signing secret in
 * DODO_WEBHOOK_SECRET.
 */
import type { FastifyInstance } from 'fastify';
import { cfg } from '../config.ts';
import { verifyDodoWebhook } from '../dodo.ts';
import { getOrder, getOrderByPayment, markOrderFailed, refundOrder, settleOrder } from '../orders.ts';
import { recordDodoPayout, settleDodoPayout } from '../settlement.ts';

interface DodoEvent {
  type: string;
  business_id?: string;
  timestamp?: string;
  data?: Record<string, any>;
}

export default async function dodoWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.post<{ Body: string }>('/webhooks/dodo', async (req, reply) => {
    if (!cfg.dodo.webhookSecret) return reply.code(501).send({ error: 'DODO_WEBHOOK_SECRET is not set' });
    if (!verifyDodoWebhook(req.body, req.headers as Record<string, string | string[] | undefined>)) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body) as DodoEvent;
    const data = event.data ?? {};

    // A payout is Dodo paying us, so it belongs to no order. On success the sales it was
    // made of become payable to their sellers; until then they were money at Dodo, not here.
    if (event.type.startsWith('payout.') && data.payout_id) {
      try {
        await recordDodoPayout(data as Parameters<typeof recordDodoPayout>[0]);
        if (event.type === 'payout.success') await settleDodoPayout(data.payout_id);
      } catch (e) {
        req.log.error(e);
        return reply.code(500).send({ error: e instanceof Error ? e.message : 'payout handling failed' });
      }
      return { received: true };
    }

    const paymentId: string | undefined = data.payment_id;

    // A payment carries the session it came from; a refund only carries the payment.
    const sessionId: string | undefined = data.checkout_session_id ?? data.session_id;
    const order = sessionId ? await getOrder(sessionId) : paymentId ? await getOrderByPayment(paymentId) : null;
    if (!order) return { received: true, ignored: 'unknown order' };

    switch (event.type) {
      case 'payment.succeeded': {
        if (!paymentId) break;
        try {
          await settleOrder(order, paymentId, null);
        } catch (e) {
          req.log.error(e);
          // Non-2xx makes Dodo retry, which is what we want for a transient failure.
          return reply.code(500).send({ error: e instanceof Error ? e.message : 'settle failed' });
        }
        break;
      }
      case 'payment.failed':
      case 'payment.cancelled':
        await markOrderFailed(order.providerOrderId);
        break;
      // Vault Market does not offer refunds, but this is not the same as refunds never
      // happening: Dodo is the merchant of record and may refund at its own discretion, and
      // a card network can force one through a chargeback whatever the policy says. Dropping
      // this would leave a refunded buyer with access and the seller still owed money that
      // was handed back.
      // A chargeback the card network decided against us is a refund by another route: the
      // buyer has the money back and, if the seller was already paid, so does the seller.
      // The purchase goes, and the balance carries the shortfall against their next sale.
      case 'dispute.lost':
      case 'dispute.accepted':
      case 'refund.succeeded':
      case 'refund.created': {
        try {
          await refundOrder(order, Number(data.amount ?? order.amount));
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
