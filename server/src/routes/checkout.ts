/**
 * Razorpay Standard Checkout, server side.
 *   POST /checkout                        create an Order for a vault -> { url, orderId, keyId, amount, currency }
 *   GET  /checkout/:orderId               hosted page that opens Checkout.js (works in a browser sheet on mobile too)
 *   POST /checkout/:orderId/callback      Checkout.js posts payment_id + signature here; verified, settled, redirected
 *   GET  /checkout/:orderId/cancel        buyer closed the modal
 *   GET  /checkout/:orderId/status        { status, paymentId } for polling
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO, cfg, platformFee } from '../config.ts';
import { getOrder, markOrderFailed, saveOrder, settleOrder, type Order } from '../orders.ts';
import { razorpay, razorpayError, verifyPaymentSignature } from '../razorpay.ts';
import { resolveReturnOrigin, returnUrl } from '../redirect.ts';
import { admin, userFromRequest } from '../supabase.ts';
import { SANITY_ENABLED, getVault } from '../sanity/index.ts';

interface CheckoutBody {
  vaultId: string;
  redirectOrigin?: string;
  /** Demo mode only: the client describes the vault because there is no database. */
  demo?: { amountCents: number; currency?: string; title: string };
}

type Row = Record<string, any>;
// The SDK's request typings are stricter than the API; bodies are validated by Razorpay itself.

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

      let order: Omit<Order, 'razorpayOrderId' | 'status' | 'paymentId' | 'signature' | 'transferId'>;
      let transfers: Row[] = [];

      if (IS_DEMO) {
        if (!demo) return reply.code(400).send({ error: 'Demo checkout needs amountCents and title' });
        order = {
          vaultId,
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

        const vault = { id: v.id, title: v.title, price_cents: v.priceCents, currency: v.currency };
        const fee = platformFee(vault.price_cents);
        const { data: seller } = await admin().from('profiles').select('razorpay_account_id, payouts_enabled').eq('id', v.sellerId).maybeSingle();
        if (cfg.razorpay.route) {
          if (!seller?.razorpay_account_id || !seller.payouts_enabled) {
            return reply.code(400).send({ error: 'This seller has not finished payout setup yet' });
          }
          transfers = [
            {
              account: seller.razorpay_account_id,
              amount: vault.price_cents - fee,
              currency: vault.currency.toUpperCase(),
              notes: { vault_id: vault.id },
              on_hold: false,
            },
          ];
        }

        order = {
          vaultId: vault.id,
          buyerId: user.id,
          buyerEmail: user.email,
          title: vault.title,
          amount: vault.price_cents,
          currency: vault.currency.toUpperCase(),
          fee,
          returnOrigin,
        };
      }

      let rzpOrder: Row;
      try {
        rzpOrder = await razorpay.orders.create({
          amount: order.amount,
          currency: order.currency,
          receipt: `vault-${order.vaultId.slice(0, 8)}-${Date.now().toString(36)}`,
          notes: { vault_id: order.vaultId, buyer_id: order.buyerId ?? 'demo', fee_cents: String(order.fee) },
          ...(transfers.length ? { transfers } : {}),
        } as any);
      } catch (e) {
        req.log.error(e);
        return reply.code(502).send({ error: razorpayError(e) });
      }

      await saveOrder({ ...order, razorpayOrderId: rzpOrder.id, status: 'created', paymentId: null, signature: null, transferId: null });

      return {
        url: `${cfg.apiUrl}/checkout/${rzpOrder.id}`,
        orderId: rzpOrder.id,
        keyId: cfg.razorpay.keyId,
        amount: order.amount,
        currency: order.currency,
      };
    }
  );

  app.get<{ Params: { orderId: string } }>('/checkout/:orderId', async (req, reply) => {
    const order = await getOrder(req.params.orderId);
    if (!order) return reply.code(404).type('text/html').send(page('Order not found', '<p>This checkout link is invalid or expired.</p>'));
    if (order.status === 'paid') return reply.redirect(returnUrl(order.returnOrigin, '/checkout-result', { status: 'success', vault: order.vaultId, payment: order.paymentId ?? undefined }));

    const options = {
      key: cfg.razorpay.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'Vault Market',
      description: order.title,
      order_id: order.razorpayOrderId,
      prefill: { email: order.buyerEmail ?? undefined },
      notes: { vault_id: order.vaultId },
      theme: { color: '#0B0B0C' },
      callback_url: `${cfg.apiUrl}/checkout/${order.razorpayOrderId}/callback`,
      redirect: true,
    };
    const cancelUrl = `${cfg.apiUrl}/checkout/${order.razorpayOrderId}/cancel`;

    reply.type('text/html').send(
      page(
        `Pay ${formatMoney(order.amount, order.currency)}`,
        `<p class="muted">${escapeHtml(order.title)}</p>
         <button id="pay" class="btn">Pay ${formatMoney(order.amount, order.currency)}</button>
         <p class="muted small">Secured by Razorpay. UPI, cards, netbanking and wallets accepted.</p>
         <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
         <script>
           const options = ${JSON.stringify(options)};
           options.modal = { ondismiss: () => { location.href = ${JSON.stringify(cancelUrl)}; } };
           const rzp = new Razorpay(options);
           document.getElementById('pay').addEventListener('click', () => rzp.open());
           rzp.open();
         </script>`
      )
    );
  });

  app.post<{ Params: { orderId: string }; Body: Record<string, string> }>('/checkout/:orderId/callback', async (req, reply) => {
    const order = await getOrder(req.params.orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    const body = req.body ?? {};
    const paymentId = body.razorpay_payment_id;
    const signature = body.razorpay_signature;
    const orderId = body.razorpay_order_id;

    if (orderId !== order.razorpayOrderId || !verifyPaymentSignature(orderId, paymentId, signature)) {
      req.log.warn({ orderId: order.razorpayOrderId }, 'invalid payment signature');
      return reply.redirect(returnUrl(order.returnOrigin, '/checkout-result', { status: 'failed', vault: order.vaultId, reason: 'signature' }));
    }

    try {
      const settled = await settleOrder(order, paymentId, signature);
      return reply.redirect(returnUrl(order.returnOrigin, '/checkout-result', { status: 'success', vault: order.vaultId, payment: settled.paymentId ?? undefined }));
    } catch (e) {
      req.log.error(e);
      return reply.redirect(returnUrl(order.returnOrigin, '/checkout-result', { status: 'failed', vault: order.vaultId, reason: 'verify' }));
    }
  });

  app.get<{ Params: { orderId: string } }>('/checkout/:orderId/cancel', async (req, reply) => {
    const order = await getOrder(req.params.orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    if (order.status !== 'paid') await markOrderFailed(order.razorpayOrderId);
    return reply.redirect(returnUrl(order.returnOrigin, '/checkout-result', { status: order.status === 'paid' ? 'success' : 'cancelled', vault: order.vaultId }));
  });

  app.get<{ Params: { orderId: string } }>('/checkout/:orderId/status', async (req, reply) => {
    const order = await getOrder(req.params.orderId);
    if (!order) return reply.code(404).send({ error: 'Order not found' });
    return { status: order.status, paymentId: order.paymentId, transferId: order.transferId, vaultId: order.vaultId };
  });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Vault Market</title>
<style>
  body{margin:0;background:#0b0b0c;color:#f4f4f5;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#141416;border:1px solid #26262a;border-radius:8px;padding:24px;max-width:420px;width:calc(100% - 32px);text-align:center}
  h1{font-size:22px;margin:0 0 8px}.muted{color:#9a9aa1;margin:0 0 16px}.small{font-size:12px;margin:12px 0 0}
  .btn{background:#f4f4f5;color:#0b0b0c;border:0;border-radius:6px;height:44px;padding:0 20px;font-weight:600;font-size:15px;cursor:pointer;width:100%}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`;
}
