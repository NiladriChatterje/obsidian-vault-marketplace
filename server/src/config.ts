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

// Render prints a private service's address as `host:port` with no scheme, which is exactly
// what gets pasted in. Fill one in rather than failing on every upload.
const rawScanner = env('SCANNER_URL').replace(/\/+$/, '');
const scannerUrl = rawScanner && !/^https?:\/\//i.test(rawScanner) ? `http://${rawScanner}` : rawScanner;

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
    url: env('NEXT_PUBLIC_SUPABASE_URL') || env('EXPO_PUBLIC_SUPABASE_URL'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    /**
     * Used for exactly one thing: checking a password on the caller's behalf during sign-in,
     * on a throwaway client. Never to read data -- that is the service key's job.
     */
    anonKey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY') || env('EXPO_PUBLIC_SUPABASE_KEY'),
  },

  /**
   * Where sign-in challenges live (see redis.ts). They expire in minutes and are read once,
   * so they belong somewhere that forgets on its own rather than in a table.
   */
  redisUrl: env('REDIS_URL'),

  /**
   * The vault scanner in `antivirus/`: every uploaded zip is posted to it before it is unpacked
   * (see malware.ts). No URL = nothing is scanned, which is for laptops: a listing is
   * downloaded by strangers, so anywhere that accepts uploads should point this at one.
   * The token is optional and must match the scanner's own SCANNER_TOKEN when it is set.
   */
  scanner: {
    url: scannerUrl,
    token: env('SCANNER_TOKEN'),
  },

  /**
   * Queued uploads (upload-queue.ts, upload-store.ts, worker/). With the queue and the store
   * both set, a zip goes from the browser into the store and a worker scans and unpacks it
   * while the API answers at once. With either missing, POST /uploads/vault-zip does the whole
   * job inline, as it always has.
   */
  uploadQueue: {
    /** Where the tickets live. Not REDIS_URL on purpose; the two may point at one instance. */
    redisUrl: env('QUEUE_REDIS_URL'),
    /** Zips one worker process handles at once. Each holds up to 70 MB and a scanner thread. */
    concurrency: Math.max(1, Number(env('WORKER_CONCURRENCY', '2')) || 2),
  },
  uploadStore: {
    /** The S3 endpoint the API and worker reach the store at, e.g. http://minio:9000. */
    endpoint: env('MINIO_ENDPOINT').replace(/\/+$/, ''),
    /** The same store as the browser reaches it; presigned links carry this host. Defaults to the endpoint. */
    publicUrl: env('MINIO_PUBLIC_URL').replace(/\/+$/, ''),
    accessKey: env('MINIO_ACCESS_KEY'),
    secretKey: env('MINIO_SECRET_KEY'),
    bucket: env('MINIO_BUCKET', 'vault-uploads'),
  },

  /**
   * The vault store (vault-store.ts): where note bodies, attachments, covers and the scanned
   * zip live for good. Required for the catalog at all; without it every catalog route answers
   * 501. Falls back to the scan buffer's credentials when only the endpoint differs, which is
   * the two-MinIO layout docker-compose runs.
   */
  vaultStore: {
    endpoint: env('VAULT_STORE_ENDPOINT').replace(/\/+$/, ''),
    accessKey: env('VAULT_STORE_ACCESS_KEY') || env('MINIO_ACCESS_KEY'),
    secretKey: env('VAULT_STORE_SECRET_KEY') || env('MINIO_SECRET_KEY'),
    bucket: env('VAULT_STORE_BUCKET', 'vault-store'),
  },

  /** Storage plans (plans.ts), in MB. The row a seller has may carry its own figure. */
  plans: {
    freeMb: Number(env('PLAN_FREE_MB', '500')),
    plusMb: Number(env('PLAN_PLUS_MB', '2048')),
    proMb: Number(env('PLAN_PRO_MB', '5120')),
  },

  /** Brevo transactional email (see email.ts). No API key = the server sends no mail. */
  brevo: {
    apiKey: env('BREVO_API_KEY'),
    /** Must be a sender Brevo has verified, or every send is refused. */
    senderEmail: env('BREVO_EMAIL_FROM', 'obsidian.vault.marketplace@gmail.com'),
    senderName: env('BREVO_EMAIL_FROM_NAME', 'Vault Market'),
  },

  /**
   * The commission's percentage half, split by where the seller banks.
   *
   * A sale to a domestic seller costs the platform less once the money moves: the payout is
   * a near-free local transfer and nothing is converted. Reaching a seller abroad costs a
   * transfer fee and a conversion spread, so that sale carries a higher rate rather than
   * being subsidised by domestic ones.
   */
  feePercentDomestic: Number(
    env('NEXT_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC', env('EXPO_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC', env('EXPO_PUBLIC_PLATFORM_FEE_PERCENT', '8')))
  ),
  feePercentInternational: Number(env('NEXT_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL', env('EXPO_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL', '12'))),
  /**
   * The fixed half of the commission, which exists to cancel the provider's fixed fee. A
   * percentage-only commission always loses below some price, because a percentage shrinks
   * with the price and the provider's flat charge does not.
   */
  feeFixedCents: Number(env('NEXT_PUBLIC_PLATFORM_FEE_FIXED_CENTS', env('EXPO_PUBLIC_PLATFORM_FEE_FIXED_CENTS', '4000'))),
  /** What the payment provider takes per sale: Dodo is 4% + $0.40, here in the listing currency. */
  providerPercentFee: Number(env('NEXT_PUBLIC_PROVIDER_PERCENT_FEE', env('EXPO_PUBLIC_PROVIDER_PERCENT_FEE', '4'))),
  providerFixedFeeCents: Number(env('NEXT_PUBLIC_PROVIDER_FIXED_FEE_CENTS', env('EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS', '3500'))),
  /** Cheapest paid listing allowed. A product choice now, not a solvency one. */
  minPriceCents: Number(env('MIN_PRICE_CENTS', '4900')),

  /** Where the platform banks. A payout inside this country is a cheap domestic transfer. */
  platformCountry: env('PLATFORM_COUNTRY', 'IN').toUpperCase(),
  /**
   * What every listing is priced in and every balance is held in. A seller paid in another
   * currency is sent this amount converted at transfer time; the ledger never holds theirs.
   */
  platformCurrency: env('PLATFORM_CURRENCY', 'INR').toUpperCase(),
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
  /**
   * The least a seller is paid, by where the money goes, in the platform currency's minor
   * units. Rs 5,000 for a domestic payout; for one abroad, Rs 6,200, which is about USD 70.
   * The break-even threshold derived from the transfer cost still applies on top, so an
   * expensive route (an international bank wire) waits for more than this.
   */
  payoutThresholdDomesticCents: Number(env('PAYOUT_THRESHOLD_DOMESTIC_CENTS', '500000')),
  payoutThresholdInternationalCents: Number(env('PAYOUT_THRESHOLD_INTERNATIONAL_CENTS', '620000')),
  /**
   * Payouts go out once a month, on this day, reckoned in this time zone. Balances are
   * measured as they stood at the start of that day; whatever clears later waits a month.
   */
  payoutCycleDay: Math.min(28, Math.max(1, Number(env('PAYOUT_CYCLE_DAY', '28')) || 28)),
  payoutTimeZone: env('PAYOUT_CYCLE_TIMEZONE', 'Asia/Kolkata'),
  /**
   * Days a sale is held before it can be paid out. The longer window covers the statutory
   * right of withdrawal on digital goods in the EU, the EEA and the UK; everywhere else a
   * short hold against ordinary reversals is enough and the seller is paid sooner.
   */
  holdbackDaysWithdrawal: Number(env('HOLDBACK_DAYS_WITHDRAWAL', '14')),
  holdbackDaysDefault: Number(env('HOLDBACK_DAYS_DEFAULT', '3')),
  /**
   * A sale is payable only once Dodo has settled it to us, not merely once the buyer can no
   * longer reverse it; otherwise a seller is paid from the platform's pocket while the money
   * sits at Dodo. 'no' falls back to the time window alone. That is for test mode, where
   * Dodo never pays out and nothing would ever become payable.
   */
  payoutRequireSettlement: env('PAYOUT_REQUIRE_SETTLEMENT', 'yes') !== 'no',
  /** Signs short-lived download links. Falls back to the Dodo key so nothing extra is required. */
  downloadSecret: env('DOWNLOAD_SECRET') || env('DODO_API_KEY') || 'dev-download-secret',
  /**
   * Supabase user ids allowed to reach /admin/*. Empty closes those routes entirely, so a
   * forgotten variable leaves the admin surface unavailable rather than open.
   */
  adminUserIds: env('ADMIN_USER_IDS').split(',').map((s) => s.trim()).filter(Boolean),
  /**
   * Comma-separated http(s) origins buyers may be redirected to after checkout. Empty = any.
   *
   * A trailing slash is stripped. A browser's Origin header never carries one, so a value
   * copied out of an address bar as `https://example.com/` would match nothing: CORS would
   * refuse the site's own requests and checkout would reject its own return origin.
   */
  allowedRedirectOrigins: env('ALLOWED_REDIRECT_ORIGINS')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
  /** Site origin; native buyers land there before deep-linking back into the app. */
  webOrigin: (env('NEXT_PUBLIC_REDIRECT_ORIGIN') || env('EXPO_PUBLIC_REDIRECT_ORIGIN')).replace(/\/$/, ''),
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
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or ALLOW_PUBLIC_DEMO=yes to override.',
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
/** The rate for a seller banking in `country`; domestic sales cost less to settle. */
export function feePercentFor(sellerCountry?: string | null): number {
  const domestic = (sellerCountry ?? cfg.platformCountry).trim().toUpperCase() === cfg.platformCountry;
  return domestic ? cfg.feePercentDomestic : cfg.feePercentInternational;
}

export function platformFee(amount: number, sellerCountry?: string | null): number {
  if (amount <= 0) return 0;
  return Math.min(amount, Math.round((amount * feePercentFor(sellerCountry)) / 100) + cfg.feeFixedCents);
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
  // The domestic rate is the lower of the two, so it is the one that has to clear.
  const margin = cfg.feePercentDomestic - cfg.providerPercentFee;
  // A commission below the provider's own percentage can never break even at any price.
  if (margin <= 0) return 100_000;
  // Only the shortfall between the two fixed fees still has to be earned back out of the
  // price. Cover theirs fully and there is nothing left for the price to cover, so the
  // floor stops being a solvency question and becomes a product one.
  const shortfall = Math.max(0, cfg.providerFixedFeeCents - cfg.feeFixedCents);
  const breakEven = (shortfall * 100) / margin;
  return Math.max(cfg.minPriceCents, Math.ceil((breakEven * 1.2) / 5000) * 5000);
}
