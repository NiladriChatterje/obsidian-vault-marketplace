/**
 * Runtime configuration. All values come from NEXT_PUBLIC_* env vars so they
 * are safe to ship in the client bundle (anon key only, never the service key).
 *
 * When SUPABASE_URL is missing the app runs in demo mode: an in-memory
 * marketplace with seed data, fake auth and instant "purchases". This makes the
 * UI fully usable in Expo Go before any backend exists.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const IS_DEMO = !SUPABASE_URL || !SUPABASE_ANON_KEY;

/** Platform commission on every paid sale, in percent. Enforced by the payment server (server/). */
/**
 * The commission's percentage half, split by where the seller banks.
 *
 * A domestic payout is a near-free local transfer with nothing converted; reaching a seller
 * abroad costs a transfer fee and a conversion spread. That sale carries the higher rate
 * rather than being subsidised by domestic ones.
 *
 * Mirrors feePercentFor() in server/src/config.ts, which is authoritative.
 */
export const PLATFORM_COUNTRY = (process.env.NEXT_PUBLIC_PLATFORM_COUNTRY ?? 'IN').toUpperCase();
export const PLATFORM_FEE_PERCENT_DOMESTIC = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC ?? 8);
export const PLATFORM_FEE_PERCENT_INTERNATIONAL = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL ?? 12);

/**
 * The region a payout in this currency goes to, and so which rate applies: INR is IN and
 * domestic, anything else is abroad. Mirrors regionForCurrency() in server/src/payout-currencies.ts,
 * which is what the server stores; this copy only previews the rate while the form is filled in.
 */
export function regionForCurrency(currency: string): string {
  return currency.trim().toUpperCase().slice(0, 2);
}

export function feePercentFor(sellerCountry?: string | null): number {
  const domestic = (sellerCountry ?? PLATFORM_COUNTRY).trim().toUpperCase() === PLATFORM_COUNTRY;
  return domestic ? PLATFORM_FEE_PERCENT_DOMESTIC : PLATFORM_FEE_PERCENT_INTERNATIONAL;
}

export const PLATFORM_FEE_FIXED_CENTS = Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_FIXED_CENTS ?? 4000);

/** Mirrors platformFee() in server/src/config.ts, which is authoritative; keep them in step. */
export function platformFee(amountCents: number, sellerCountry?: string | null): number {
  if (amountCents <= 0) return 0;
  return Math.min(amountCents, Math.round((amountCents * feePercentFor(sellerCountry)) / 100) + PLATFORM_FEE_FIXED_CENTS);
}

/** Default currency listings are priced in. */
export const DEFAULT_CURRENCY = 'INR';

/** Minimum price a seller may set for a paid vault, in minor units (Rs 49). Mirrored in the vaults check constraint. */
/**
 * What the payment provider takes per sale. Dodo is 4% + $0.40, and the fixed part is the
 * one that matters: it does not shrink with the price, so it is what makes a cheap vault
 * cost the platform money. Expressed in the listing currency with a little headroom over
 * the live exchange rate.
 */
export const PROVIDER_PERCENT_FEE = Number(process.env.NEXT_PUBLIC_PROVIDER_PERCENT_FEE ?? 4);
export const PROVIDER_FIXED_FEE_CENTS = Number(process.env.NEXT_PUBLIC_PROVIDER_FIXED_FEE_CENTS ?? 3500);

/**
 * The cheapest paid vault that may be listed.
 *
 * Because the commission is a percentage plus a fixed amount that covers the provider's
 * own, the platform is solvent at any price, so this is a product decision: at a very low
 * price the fixed part is most of the sale and the seller is left with almost nothing,
 * which is true but reads badly. The derivation stays as a backstop, for a commission
 * configured so it no longer covers the provider's fixed fee.
 *
 * Mirrored in server/src/config.ts, which enforces it; keep the two in step.
 */
const MIN_PRICE_FLOOR_CENTS = 14900;

function deriveMinPriceCents(): number {
  // The domestic rate is the lower of the two, so it is the one that has to clear.
  const margin = PLATFORM_FEE_PERCENT_DOMESTIC - PROVIDER_PERCENT_FEE;
  // A commission that does not even cover the provider's percentage can never break even.
  if (margin <= 0) return 100_000;
  // Only the shortfall between the two fixed fees still has to come out of the price.
  const shortfall = Math.max(0, PROVIDER_FIXED_FEE_CENTS - PLATFORM_FEE_FIXED_CENTS);
  const breakEven = (shortfall * 100) / margin;
  return Math.max(MIN_PRICE_FLOOR_CENTS, Math.ceil((breakEven * 1.2) / 5000) * 5000);
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
export const API_URL = (process.env.NEXT_PUBLIC_SERVER_API_URL ?? '').replace(/\/$/, '');

/**
 * Where listings and notes come from. 'sanity' routes the catalog through the
 * payment server (which reads the private Sanity dataset); 'local' keeps the
 * built-in demo data / Supabase tables. Defaults to sanity whenever a server is configured.
 */
export const CATALOG_SOURCE: 'sanity' | 'local' =
  process.env.NEXT_PUBLIC_CATALOG_SOURCE === 'local' || !API_URL ? 'local' : 'sanity';

/**
 * Where the payment server sends the buyer after checkout.
 * Native builds use the deep-link scheme; the Next.js site (web/) sets
 * NEXT_PUBLIC_REDIRECT_ORIGIN to its own https origin, falling back to the
 * browser's location when running in a browser.
 */
export const REDIRECT_ORIGIN: string =
  process.env.NEXT_PUBLIC_REDIRECT_ORIGIN ||
  (typeof location !== 'undefined' && /^https?:/.test(location.origin ?? '') ? location.origin : `${APP_SCHEME}:/`);

export const MAX_VAULT_ZIP_BYTES = 200 * 1024 * 1024;
