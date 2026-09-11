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
 * refund.succeeded, and put the signing secret in DODO_WEBHOOK_SECRET.
 */
import type { FastifyInstance } from 'fastify';
import { cfg } from '../config.ts';
import { verifyDodoWebhook } from '../dodo.ts';
import { getOrder, getOrderByPayment, markOrderFailed, refundOrder, settleOrder } from '../orders.ts';

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
