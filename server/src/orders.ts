/**
 * Order bookkeeping. With Supabase configured, rows live in public.orders and
 * paid orders become public.purchases. In demo mode orders live in memory so
 * the hosted checkout page and signature verification still work end to end.
 */
import { IS_DEMO } from './config.ts';
import { razorpay, razorpayError } from './razorpay.ts';
import { admin } from './supabase.ts';

export type OrderStatus = 'created' | 'paid' | 'failed';

export interface Order {
  razorpayOrderId: string;
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
  transferId: string | null;
}

const memory = new Map<string, Order>();

type Row = Record<string, any>;
const fromRow = (r: Row): Order => ({
  razorpayOrderId: r.razorpay_order_id,
  vaultId: r.vault_id,
  buyerId: r.buyer_id,
  buyerEmail: r.buyer_email,
  title: r.title,
  amount: r.amount_cents,
  currency: r.currency,
  fee: r.fee_cents,
  returnOrigin: r.return_origin,
  status: r.status,
  paymentId: r.razorpay_payment_id,
  signature: r.razorpay_signature,
  transferId: r.razorpay_transfer_id,
});

export async function saveOrder(order: Order): Promise<void> {
  if (IS_DEMO) {
    memory.set(order.razorpayOrderId, order);
    return;
  }
  const { error } = await admin().from('orders').insert({
    razorpay_order_id: order.razorpayOrderId,
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

export async function getOrder(razorpayOrderId: string): Promise<Order | null> {
  if (IS_DEMO) return memory.get(razorpayOrderId) ?? null;
  const { data, error } = await admin().from('orders').select('*').eq('razorpay_order_id', razorpayOrderId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

async function updateOrder(razorpayOrderId: string, patch: Partial<Order>): Promise<void> {
  if (IS_DEMO) {
    const o = memory.get(razorpayOrderId);
    if (o) Object.assign(o, patch);
    return;
  }
  const row: Row = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.paymentId !== undefined) row.razorpay_payment_id = patch.paymentId;
  if (patch.signature !== undefined) row.razorpay_signature = patch.signature;
  if (patch.transferId !== undefined) row.razorpay_transfer_id = patch.transferId;
  if (patch.status === 'paid') row.paid_at = new Date().toISOString();
  const { error } = await admin().from('orders').update(row).eq('razorpay_order_id', razorpayOrderId);
  if (error) throw new Error(error.message);
}

export async function markOrderFailed(razorpayOrderId: string): Promise<void> {
  const order = await getOrder(razorpayOrderId);
  if (order && order.status !== 'paid') await updateOrder(razorpayOrderId, { status: 'failed' });
}

/**
 * Marks an order paid and grants the vault. Idempotent: called from the
 * checkout callback and again from the webhook. Confirms the payment with
 * Razorpay (captures it if only authorised) before trusting it.
 */
export async function settleOrder(order: Order, paymentId: string, signature: string | null): Promise<Order> {
  if (order.status === 'paid' && order.paymentId === paymentId) return order;

  let payment: Row;
  try {
    payment = await razorpay.payments.fetch(paymentId);
  } catch (e) {
    throw new Error(`Could not fetch payment: ${razorpayError(e)}`);
  }
  if (payment.order_id !== order.razorpayOrderId) throw new Error('Payment does not belong to this order');
  if (payment.status === 'authorized') {
    payment = await razorpay.payments.capture(paymentId, order.amount, order.currency);
  }
  if (payment.status !== 'captured') throw new Error(`Payment is ${payment.status}, not captured`);
  if (Number(payment.amount) !== order.amount) throw new Error('Paid amount does not match the order');

  // Route transfer created with the order, if any.
  let transferId: string | null = null;
  try {
    const transfers = await razorpay.payments.fetchTransfer(paymentId);
    transferId = (transfers as Row)?.items?.[0]?.id ?? null;
  } catch {
    // Route not enabled or no transfers on this order.
  }

  await updateOrder(order.razorpayOrderId, { status: 'paid', paymentId, signature, transferId });

  if (!IS_DEMO && order.buyerId) {
    const { error } = await admin()
      .from('purchases')
      .upsert(
        {
          vault_id: order.vaultId,
          buyer_id: order.buyerId,
          amount_cents: order.amount,
          fee_cents: order.fee,
          razorpay_payment_id: paymentId,
          razorpay_transfer_id: transferId,
        },
        { onConflict: 'vault_id,buyer_id' }
      );
    if (error) throw new Error(error.message);
  }

  return { ...order, status: 'paid', paymentId, signature, transferId };
}
