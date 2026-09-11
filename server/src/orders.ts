/**
 * Order bookkeeping, one shape whichever provider took the payment. With Supabase
 * configured, rows live in public.orders and paid orders become public.purchases. In demo
 * mode orders live in memory so checkout still works end to end.
 *
 * Nothing splits a payment any more: under a merchant of record the platform is the seller
 * and creators are paid outside the checkout, so there is no transfer to track or reverse.
 */
import { IS_DEMO } from './config.ts';
import { dodo } from './dodo.ts';
import { razorpay, razorpayError } from './razorpay.ts';
import { admin } from './supabase.ts';

export type OrderStatus = 'created' | 'paid' | 'failed' | 'refunded';

export type PaymentProvider = 'razorpay' | 'dodo';

export interface Order {
  provider: PaymentProvider;
  /** Razorpay order id, or the Dodo checkout session id. */
  providerOrderId: string;
  vaultId: string;
  buyerId: string | null;
  buyerEmail: string | null;
  title: string;
  amount: number;
  currency: string;
  fee: number;
  /** Where the buyer goes after checkout, e.g. https://vault.market or vaultmarket:/ */
  returnOrigin: string;
  status: OrderStatus;
  paymentId: string | null;
  signature: string | null;
}

const memory = new Map<string, Order>();

type Row = Record<string, any>;
const fromRow = (r: Row): Order => ({
  provider: (r.provider ?? 'razorpay') as PaymentProvider,
  providerOrderId: r.provider_order_id,
  vaultId: r.vault_id,
  buyerId: r.buyer_id,
  buyerEmail: r.buyer_email,
  title: r.title,
  amount: r.amount_cents,
  currency: r.currency,
  fee: r.fee_cents,
  returnOrigin: r.return_origin,
  status: r.status,
  paymentId: r.provider_payment_id,
  signature: r.provider_signature,
});

export async function saveOrder(order: Order): Promise<void> {
  if (IS_DEMO) {
    memory.set(order.providerOrderId, order);
    return;
  }
  const { error } = await admin().from('orders').insert({
    provider: order.provider,
    provider_order_id: order.providerOrderId,
    vault_id: order.vaultId,
    buyer_id: order.buyerId,
    buyer_email: order.buyerEmail,
    title: order.title,
    amount_cents: order.amount,
    currency: order.currency,
    fee_cents: order.fee,
    return_origin: order.returnOrigin,
    status: order.status,
  });
  if (error) throw new Error(error.message);
}

export async function getOrder(providerOrderId: string): Promise<Order | null> {
  if (IS_DEMO) return memory.get(providerOrderId) ?? null;
  const { data, error } = await admin().from('orders').select('*').eq('provider_order_id', providerOrderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

async function updateOrder(providerOrderId: string, patch: Partial<Order>): Promise<void> {
  if (IS_DEMO) {
    const o = memory.get(providerOrderId);
    if (o) Object.assign(o, patch);
    return;
  }
  const row: Row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.paymentId !== undefined) row.provider_payment_id = patch.paymentId;
  if (patch.signature !== undefined) row.provider_signature = patch.signature;
  if (patch.status === 'paid') row.paid_at = new Date().toISOString();
  if (patch.status === 'refunded') row.refunded_at = new Date().toISOString();
  const { error } = await admin().from('orders').update(row).eq('provider_order_id', providerOrderId);
  if (error) throw new Error(error.message);
}

export async function markOrderFailed(providerOrderId: string): Promise<void> {
  const order = await getOrder(providerOrderId);
  if (order && order.status !== 'paid') await updateOrder(providerOrderId, { status: 'failed' });
}

/**
 * Marks an order paid and grants the vault. Idempotent: called from the checkout callback
 * and again from the webhook, and both providers retry.
 *
 * The payment is re-read from the provider before it is trusted, because the caller's word
 * for it arrives over a redirect the buyer controls.
 */
export async function settleOrder(order: Order, paymentId: string, signature: string | null): Promise<Order> {
  if (order.status === 'paid' && order.paymentId === paymentId) return order;

  if (order.provider === 'razorpay') await confirmRazorpayPayment(order, paymentId);
  else await confirmDodoPayment(order, paymentId);

  await updateOrder(order.providerOrderId, { status: 'paid', paymentId, signature });

  if (!IS_DEMO && order.buyerId) {
    const { error } = await admin()
      .from('purchases')
      .upsert(
        {
          vault_id: order.vaultId,
          buyer_id: order.buyerId,
          amount_cents: order.amount,
          fee_cents: order.fee,
          provider_payment_id: paymentId,
        },
        { onConflict: 'vault_id,buyer_id' }
      );
    if (error) throw new Error(error.message);
  }

  return { ...order, status: 'paid', paymentId, signature };
}

/** Razorpay authorises first and captures second, so an authorised payment is captured here. */
async function confirmRazorpayPayment(order: Order, paymentId: string): Promise<void> {
  let payment: Row;
  try {
    payment = await razorpay.payments.fetch(paymentId);
  } catch (e) {
    throw new Error(`Could not fetch payment: ${razorpayError(e)}`);
  }
  if (payment.order_id !== order.providerOrderId) throw new Error('Payment does not belong to this order');
  if (payment.status === 'authorized') payment = await razorpay.payments.capture(paymentId, order.amount, order.currency);
  if (payment.status !== 'captured') throw new Error(`Payment is ${payment.status}, not captured`);
  if (Number(payment.amount) !== order.amount) throw new Error('Paid amount does not match the order');
}

/**
 * Dodo captures on its own side, so there is nothing to capture here — only to confirm.
 * The amount is not compared: Dodo is the merchant of record and charges the buyer in
 * their own currency after tax and any purchasing-power adjustment, so what they paid is
 * legitimately not what the listing says in INR.
 */
async function confirmDodoPayment(order: Order, paymentId: string): Promise<void> {
  if (IS_DEMO) return;
  const payment = (await dodo().payments.retrieve(paymentId)) as Row;
  if (payment.status !== 'succeeded') throw new Error(`Payment is ${payment.status}, not succeeded`);
  const metadataVault = payment.metadata?.vault_id;
  if (metadataVault && metadataVault !== order.vaultId) throw new Error('Payment does not belong to this order');
}

/** Refunds arrive by webhook keyed on the payment, not the order. */
export async function getOrderByPayment(paymentId: string): Promise<Order | null> {
  if (IS_DEMO) {
    for (const o of memory.values()) if (o.paymentId === paymentId) return o;
    return null;
  }
  const { data, error } = await admin().from('orders').select('*').eq('provider_payment_id', paymentId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

/**
 * Undoes a paid order after the provider refunded the buyer. The money is back, so the
 * access goes too.
 *
 * There is nothing to claw back from anyone else: the platform is the seller, and a
 * creator's royalty is paid outside the checkout, so a refund is settled between us and
 * them like any other supplier credit rather than by reversing a split.
 *
 * Idempotent: both providers send more than one event per refund and retry anything they
 * do not get a 2xx for.
 */
export async function refundOrder(order: Order, _refundedAmount: number): Promise<void> {
  if (order.status === 'refunded') return;
  await updateOrder(order.providerOrderId, { status: 'refunded' });

  if (!IS_DEMO && order.buyerId) {
    const { error } = await admin().from('purchases').delete().eq('vault_id', order.vaultId).eq('buyer_id', order.buyerId);
    if (error) throw new Error(error.message);
  }
}
