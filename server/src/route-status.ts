/**
 * What Razorpay has actually said about Route on this account.
 *
 * `cfg.razorpay.route` is only our intent: it is the RAZORPAY_ROUTE env flag, and it
 * reads `true` on an account that rejects every transfer. Reporting that from /health
 * is worse than reporting nothing, because it is read as confirmation during launch.
 *
 * There is no side-effect-free way to ask. The Route endpoints do not answer a
 * capability question: `transfers.all()` 404s, and `accounts.fetch` on an unknown id
 * returns "The id provided does not exist" whether or not we have access. The calls
 * that do answer — creating an order with transfers, creating a linked account — both
 * create something when they succeed, which a health check must not do.
 *
 * So this records what real calls observed instead. Checkout and payout onboarding
 * report their outcome here, /health surfaces it, and `npm run check-route` forces a
 * definitive answer on demand.
 */

export type RouteVerdict = 'unknown' | 'available' | 'unavailable';

interface Observation {
  verdict: RouteVerdict;
  detail: string | null;
  at: string | null;
}

let observed: Observation = { verdict: 'unknown', detail: null, at: null };

/**
 * Razorpay's two refusals for an account without Route. Matched narrowly: a
 * transfer can also fail for reasons that say nothing about eligibility (a
 * linked account that is not activated, an amount above the payment), and
 * calling those "unavailable" would send someone chasing the wrong problem.
 */
const NO_ROUTE = [/transfer is not supported/i, /access denied/i];

export function isRouteUnavailable(message: string): boolean {
  return NO_ROUTE.some((re) => re.test(message));
}

export function recordRouteAvailable(): void {
  observed = { verdict: 'available', detail: null, at: new Date().toISOString() };
}

/** Only downgrades on a refusal we recognise; other failures leave the verdict alone. */
export function recordRouteFailure(message: string): void {
  if (isRouteUnavailable(message)) observed = { verdict: 'unavailable', detail: message, at: new Date().toISOString() };
}

export function routeStatus(configured: boolean): {
  configured: boolean;
  verified: RouteVerdict;
  detail?: string;
  checkedAt?: string;
  note?: string;
} {
  return {
    configured,
    verified: observed.verdict,
    ...(observed.detail ? { detail: observed.detail } : {}),
    ...(observed.at ? { checkedAt: observed.at } : {}),
    ...(observed.verdict === 'unknown'
      ? { note: 'No Route call has been made since boot. Run `npm run check-route` in server/ for a definitive answer.' }
      : {}),
  };
}
