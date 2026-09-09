/**
 * Runs on plain Node (type stripping, no build step). Reads the repo-root .env
 * so the app, the site and this server share one file.
 */
import './env.ts';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

const port = Number(env('API_PORT', '4000'));

export const cfg = {
  port,
  /** Public URL of this server; Razorpay posts the checkout result back here. */
  apiUrl: env('EXPO_PUBLIC_API_URL', `http://localhost:${port}`).replace(/\/$/, ''),

  razorpay: {
    keyId: env('RAZORPAY_CLIENT_KEY'),
    keySecret: env('RAZORPAY_SECRET_KEY'),
    /** Accepts the older MERCHANT_ID spelling so existing .env files keep working. */
    merchantId: env('RAZORPAY_MERCHANT_ID') || env('MERCHANT_ID'),
    webhookSecret: env('RAZORPAY_WEBHOOK_SECRET'),
    /** 'on' (default) splits every paid order to the seller's Route linked account; 'off' keeps everything on the platform account. */
    route: env('RAZORPAY_ROUTE', 'on') !== 'off',
    linkedCategory: env('RAZORPAY_LINKED_CATEGORY', 'education'),
    linkedSubcategory: env('RAZORPAY_LINKED_SUBCATEGORY', 'elearning'),
  },

  supabase: {
    url: env('EXPO_PUBLIC_SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  },

  feePercent: Number(env('EXPO_PUBLIC_PLATFORM_FEE_PERCENT', env('PLATFORM_FEE_PERCENT', '10'))),
  /** Signs short-lived download links. Falls back to the Razorpay secret so nothing extra is required. */
  downloadSecret: env('DOWNLOAD_SECRET') || env('RAZORPAY_SECRET_KEY') || 'dev-download-secret',
  /** Comma-separated http(s) origins buyers may be redirected to after checkout. Empty = any. */
  allowedRedirectOrigins: env('ALLOWED_REDIRECT_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  /** Site origin; native buyers land there before deep-linking back into the app. */
  webOrigin: env('EXPO_PUBLIC_REDIRECT_ORIGIN').replace(/\/$/, ''),
};

/** No Supabase: orders live in memory and the client grants demo purchases itself. Real Razorpay test payments still work. */
export const IS_DEMO = !cfg.supabase.url || !cfg.supabase.serviceKey;

export function platformFee(amount: number): number {
  return Math.round((amount * cfg.feePercent) / 100);
}
