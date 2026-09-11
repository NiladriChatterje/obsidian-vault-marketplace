/**
 * Runs on plain Node (type stripping, no build step). Reads the repo-root .env
 * so the app, the site and this server share one file.
 */
import './env.ts';

const env = (key: string, fallback = '') => (process.env[key] ?? fallback).trim();

// API_PORT first so the shared root .env keeps naming this server's port explicitly (a bare
// PORT there would collide with Next's). Hosts that inject PORT — Render, Fly, Railway — are
// picked up when API_PORT is unset, so no host-specific config is needed.
const port = Number(env('API_PORT') || env('PORT', '4000'));

export const cfg = {
  port,
  /** Public URL of this server; the buyer is sent back here after checkout. */
  apiUrl: env('SERVER_API_URL', `http://localhost:${port}`).replace(/\/$/, ''),

  /**
   * Dodo Payments, the merchant of record. It is the seller of record to the buyer, so it
   * handles global cards and local methods, registers and remits VAT / sales tax, and
   * settles the net to our bank. It is the only payment rail; without DODO_API_KEY no paid
   * checkout can be created.
   */
  dodo: {
    apiKey: env('DODO_API_KEY'),
    webhookSecret: env('DODO_WEBHOOK_SECRET'),
    /** Anything but 'live' stays on Dodo's test host, so a stray key cannot take real money. */
    live: env('DODO_ENVIRONMENT', 'test') === 'live',
  },

  supabase: {
    url: env('EXPO_PUBLIC_SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
  },

  /** Brevo transactional email (see email.ts). No API key = the server sends no mail. */
  brevo: {
    apiKey: env('BREVO_API_KEY'),
    /** Must be a sender Brevo has verified, or every send is refused. */
    senderEmail: env('BREVO_EMAIL_FROM', 'obsidian.vault.marketplace@gmail.com'),
    senderName: env('BREVO_EMAIL_FROM_NAME', 'Vault Market'),
  },

  feePercent: Number(env('EXPO_PUBLIC_PLATFORM_FEE_PERCENT', env('PLATFORM_FEE_PERCENT', '10'))),
  /** Signs short-lived download links. Falls back to the Dodo key so nothing extra is required. */
  downloadSecret: env('DOWNLOAD_SECRET') || env('DODO_API_KEY') || 'dev-download-secret',
  /**
   * Supabase user ids allowed to reach /admin/*. Empty closes those routes entirely, so a
   * forgotten variable leaves the admin surface unavailable rather than open.
   */
  adminUserIds: env('ADMIN_USER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
  /** Comma-separated http(s) origins buyers may be redirected to after checkout. Empty = any. */
  allowedRedirectOrigins: env('ALLOWED_REDIRECT_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
  /** Site origin; native buyers land there before deep-linking back into the app. */
  webOrigin: env('EXPO_PUBLIC_REDIRECT_ORIGIN').replace(/\/$/, ''),
};

/** No Supabase: orders live in memory and the client grants demo purchases itself. */
export const IS_DEMO = !cfg.supabase.url || !cfg.supabase.serviceKey;

/** A real deployment rather than a laptop: set by Render, Fly, Railway and by our own Dockerfile. */
const IS_HOSTED =
  env('NODE_ENV') === 'production' || !!env('RENDER') || !!env('FLY_APP_NAME') || !!env('RAILWAY_ENVIRONMENT');

/**
 * Demo mode trusts an x-demo-user header and hands whoever sends it ownership of every
 * vault (see access.ts), which would give paid note bodies away for free. It exists for
 * laptops, so a hosted process that lands in it has lost its Supabase config: fail loudly
 * at boot rather than quietly serving the catalog for nothing. Deliberate public demos can
 * set ALLOW_PUBLIC_DEMO=yes.
 */
if (IS_DEMO && IS_HOSTED && env('ALLOW_PUBLIC_DEMO') !== 'yes') {
  throw new Error(
    'Refusing to start in demo mode on a hosted instance: demo mode grants every caller ownership of every vault. ' +
    'Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or ALLOW_PUBLIC_DEMO=yes to override.',
  );
}

export function platformFee(amount: number): number {
  return Math.round((amount * cfg.feePercent) / 100);
}
