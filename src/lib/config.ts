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

/** Default currency for listings. Razorpay settles in INR. */
export const DEFAULT_CURRENCY = 'INR';

/** Minimum price a seller may set for a paid vault, in minor units (Rs 49). Mirrored in the vaults check constraint. */
export const MIN_PRICE_CENTS = 4900;

export const APP_SCHEME = 'vaultmarket';

/**
 * Base URL of the Fastify payment server (server/). It creates Razorpay orders,
 * hosts the checkout page, verifies signatures and onboards sellers.
 * Empty means "no server": paid checkout is unavailable outside demo mode.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

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
