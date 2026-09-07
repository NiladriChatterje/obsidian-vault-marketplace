import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
import { cfg } from './config.ts';

if (!cfg.razorpay.keyId || !cfg.razorpay.keySecret) {
  throw new Error('RAZORPAY_CLIENT_KEY and RAZORPAY_SECRET_KEY must be set in the repo-root .env');
}

export const razorpay = new Razorpay({ key_id: cfg.razorpay.keyId, key_secret: cfg.razorpay.keySecret });

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Standard Checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key_secret).
 * Sent by Checkout.js to callback_url (or the handler) after a successful payment.
 */
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!orderId || !paymentId || !signature) return false;
  return safeEqual(hmacHex(`${orderId}|${paymentId}`, cfg.razorpay.keySecret), signature);
}

/** Webhook signature: HMAC-SHA256(raw body, webhook secret) in the X-Razorpay-Signature header. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!cfg.razorpay.webhookSecret || !signature) return false;
  return safeEqual(hmacHex(rawBody, cfg.razorpay.webhookSecret), signature);
}

/** Razorpay SDK errors carry the message under error.description. */
export function razorpayError(e: unknown): string {
  const err = e as { error?: { description?: string }; message?: string };
  return err?.error?.description ?? err?.message ?? 'Razorpay request failed';
}
