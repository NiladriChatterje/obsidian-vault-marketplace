/**
 * Runtime configuration. All values come from EXPO_PUBLIC_* env vars so they
 * are safe to ship in the client bundle (anon key only, never the service key).
 *
 * When SUPABASE_URL is missing the app runs in demo mode: an in-memory
 * marketplace with seed data, fake auth and instant "purchases". This makes the
 * UI fully usable in Expo Go before any backend exists.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Platform commission on every paid sale, in percent. Enforced by the payment server (server/). */
export const PLATFORM_FEE_PERCENT = Number(process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT ?? 15);

/** Default currency listings are priced in. */
export const DEFAULT_CURRENCY = 'INR';

/** Minimum price a seller may set for a paid vault, in minor units (Rs 49). Mirrored in the vaults check constraint. */
/**
 * What the payment provider takes per sale. Dodo is 4% + $0.40, and the fixed part is the
 * one that matters: it does not shrink with the price, so it is what makes a cheap vault
 * cost the platform money. Expressed in the listing currency with a little headroom over
 * the live exchange rate.
 */
export const PROVIDER_PERCENT_FEE = Number(process.env.EXPO_PUBLIC_PROVIDER_PERCENT_FEE ?? 4);
export const PROVIDER_FIXED_FEE_CENTS = Number(process.env.EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS ?? 4000);

/**
 * The cheapest paid vault that does not lose the platform money.
 *
 * The seller takes their share of the **list** price, so the provider's fee comes wholly
 * out of the commission:
 *
 *   kept = price x (commission - provider%) / 100 - providerFixed
 *
 * which is zero at `providerFixed x 100 / (commission - provider%)`. Below that every sale
 * is a loss, and at a 10% commission that threshold is about Rs 587, far above the Rs 49
 * this used to be hardcoded at. Deriving it means changing the commission moves the floor
 * with it instead of silently reintroducing the same hole.
 *
 * Mirrored in server/src/config.ts, which enforces it; keep the two in step.
 */
function deriveMinPriceCents(): number {
  const margin = PLATFORM_FEE_PERCENT - PROVIDER_PERCENT_FEE;
  // A commission that does not even cover the provider's percentage can never break even.
  if (margin <= 0) return 100_000;
  const breakEven = (PROVIDER_FIXED_FEE_CENTS * 100) / margin;
  // 20% of headroom, rounded up to a round Rs 50, so the floor reads like a price.
  return Math.ceil((breakEven * 1.2) / 5000) * 5000;
}

export const MIN_PRICE_CENTS = deriveMinPriceCents();

/**
 * Minimum password length, enforced in the sign-up form. Supabase enforces its own
 * minimum server-side (Authentication -> Providers -> Email); keep the two in step,
 * since the dashboard default is 6.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const APP_SCHEME = 'vaultmarket';

/**
 * Base URL of the Fastify payment server (server/). It opens checkout sessions,
 * hosts the checkout page, verifies signatures and onboards sellers.
 * Empty means "no server": paid checkout is unavailable outside demo mode.
 */
export const API_URL = (process.env.SERVER_API_URL ?? '').replace(/\/$/, '');

/**
 * Where listings and notes come from. 'sanity' routes the catalog through the
 * payment server (which reads the private Sanity dataset); 'local' keeps the
 * built-in demo data / Supabase tables. Defaults to sanity whenever a server is configured.
 */
export const CATALOG_SOURCE: 'sanity' | 'local' =
  process.env.EXPO_PUBLIC_CATALOG_SOURCE === 'local' || !API_URL ? 'local' : 'sanity';

/**
 * Where the payment server sends the buyer after checkout.
 * Native builds use the deep-link scheme; the Next.js site (web/) sets
 * EXPO_PUBLIC_REDIRECT_ORIGIN to its own https origin, falling back to the
 * browser's location when running in a browser.
 */
export const REDIRECT_ORIGIN: string =
  process.env.EXPO_PUBLIC_REDIRECT_ORIGIN ||
  (typeof location !== 'undefined' && /^https?:/.test(location.origin ?? '') ? location.origin : `${APP_SCHEME}:/`);

export const STORAGE_BUCKETS = {
  covers: 'vault-covers',
  files: 'vault-files',
} as const;

export const MAX_VAULT_ZIP_BYTES = 200 * 1024 * 1024;
