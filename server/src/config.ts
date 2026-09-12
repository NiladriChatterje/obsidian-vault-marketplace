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
  /**
   * The fixed half of the commission, which exists to cancel the provider's fixed fee. A
   * percentage-only commission always loses below some price, because a percentage shrinks
   * with the price and the provider's flat charge does not.
   */
  feeFixedCents: Number(env('EXPO_PUBLIC_PLATFORM_FEE_FIXED_CENTS', '4000')),
  /** What the payment provider takes per sale: Dodo is 4% + $0.40, here in the listing currency. */
  providerPercentFee: Number(env('EXPO_PUBLIC_PROVIDER_PERCENT_FEE', '4')),
  providerFixedFeeCents: Number(env('EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS', '3500')),
  /** Cheapest paid listing allowed. A product choice now, not a solvency one. */
  minPriceCents: Number(env('MIN_PRICE_CENTS', '19900')),

  /** Where the platform banks. A payout inside this country is a cheap domestic transfer. */
  platformCountry: env('PLATFORM_COUNTRY', 'IN').toUpperCase(),
  /**
   * What one payout costs to send, in the listing currency's minor units. Pessimistic on
   * purpose: guessing high only delays a payout, guessing low loses money on it.
   */
  transferCost: {
    bankDomestic: Number(env('TRANSFER_COST_BANK_DOMESTIC', '500')),
    bankInternational: Number(env('TRANSFER_COST_BANK_INTERNATIONAL', '150000')),
    wise: Number(env('TRANSFER_COST_WISE', '20000')),
    payoneer: Number(env('TRANSFER_COST_PAYONEER', '20000')),
    paypal: Number(env('TRANSFER_COST_PAYPAL', '15000')),
  },
  /** Headroom over the break-even threshold, so a payout is never marginal. */
  payoutSafetyFactor: Number(env('PAYOUT_SAFETY_FACTOR', '1.35')),
  /** No payout below this however cheap the transfer, so payouts stay worth processing. */
  payoutMinCents: Number(env('PAYOUT_MIN_CENTS', '50000')),
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

/**
 * The platform's cut of a sale: a percentage plus a fixed amount.
 *
 * The fixed part is the point. The provider charges a percentage plus a flat fee, so a
 * commission that is only a percentage is guaranteed to lose money below some price, however
 * high the percentage. Matching the shape makes every sale carry its own processing cost:
 *
 *   kept = price x (commission% - provider%) / 100 + (commissionFixed - providerFixed)
 *
 * which stays positive at any price as long as both halves cover the provider's.
 *
 * Free vaults are free: they never reach the provider, so they cost nothing and are charged
 * nothing. The clamp is a guard, not a normal path; minPriceCents keeps prices well above it.
 */
export function platformFee(amount: number): number {
  if (amount <= 0) return 0;
  return Math.min(amount, Math.round((amount * cfg.feePercent) / 100) + cfg.feeFixedCents);
}

/**
 * The cheapest paid vault that may be listed.
 *
 * With a percentage-plus-fixed commission the platform is solvent at any price, so this is
 * a product decision rather than a solvency one: at a very low price the fixed part is most
 * of the sale and the seller is left with almost nothing, which is true but reads badly.
 * The derivation stays as a backstop, in case the commission is ever configured so that it
 * no longer covers the provider's fixed fee.
 *
 * Mirrored in web/src/lib/config.ts, which shows it to the seller; keep the two in step.
 */
export function minPriceCents(): number {
  const margin = cfg.feePercent - cfg.providerPercentFee;
  // A commission below the provider's own percentage can never break even at any price.
  if (margin <= 0) return 100_000;
  // Only the shortfall between the two fixed fees still has to be earned back out of the
  // price. Cover theirs fully and there is nothing left for the price to cover, so the
  // floor stops being a solvency question and becomes a product one.
  const shortfall = Math.max(0, cfg.providerFixedFeeCents - cfg.feeFixedCents);
  const breakEven = (shortfall * 100) / margin;
  return Math.max(cfg.minPriceCents, Math.ceil((breakEven * 1.2) / 5000) * 5000);
}
