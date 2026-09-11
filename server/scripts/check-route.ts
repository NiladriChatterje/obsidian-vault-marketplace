/**
 * Does this Razorpay account actually have Route? Answers definitively.
 *
 *   node server/scripts/check-route.ts        (reads the repo-root .env)
 *
 * /health only reports what the server has observed from real traffic, and the
 * RAZORPAY_ROUTE flag reports nothing at all — it reads `true` on an account that
 * rejects every transfer. This asks Razorpay.
 *
 * There is no read-only way to ask, so this creates one throwaway Order carrying a
 * transfers array. An unpaid order costs nothing, moves no money and expires on its
 * own; it is the same call checkout makes. Nothing else is created: the linked-account
 * probe is sent with a deliberately invalid email so it can only fail, and we read the
 * shape of the failure.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

const { default: Razorpay } = await import('razorpay');

const keyId = (process.env.RAZORPAY_CLIENT_KEY ?? '').trim();
const keySecret = (process.env.RAZORPAY_SECRET_KEY ?? '').trim();
if (!keyId || !keySecret) {
  console.error('RAZORPAY_CLIENT_KEY and RAZORPAY_SECRET_KEY must be set in the repo-root .env');
  process.exit(1);
}

const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
const mode = keyId.split('_')[1] ?? 'unknown';
const describe = (e: any): string => e?.error?.description ?? e?.message ?? String(e);

console.log(`Razorpay key mode: ${mode}`);
console.log(`RAZORPAY_ROUTE flag: ${process.env.RAZORPAY_ROUTE?.trim() || 'unset (defaults to on)'}\n`);

let splitOk = false;
let onboardOk = false;

// 1. Can an order carry a split? This is what every paid checkout does.
try {
  const order = (await rzp.orders.create({
    amount: 10000,
    currency: 'INR',
    receipt: `route-check-${Date.now().toString(36)}`,
    transfers: [{ account: 'acc_00000000000000', amount: 9000, currency: 'INR' }],
  } as any)) as Record<string, any>;
  // Reached Razorpay's linked-account lookup, so splitting itself is permitted.
  splitOk = true;
  console.log(`split payments   : AVAILABLE (test order ${order.id} created and left unpaid)`);
} catch (e) {
  const message = describe(e);
  // "This transfer is not supported" is the refusal an ineligible account gets. Anything
  // else — an unknown linked account, for instance — means splitting itself works.
  splitOk = !/transfer is not supported/i.test(message);
  console.log(`split payments   : ${splitOk ? 'AVAILABLE' : 'NOT AVAILABLE'} — ${message}`);
}

// 2. Can we create linked accounts, i.e. onboard sellers without sending them to Razorpay?
try {
  await rzp.accounts.create({
    email: 'not-an-email',
    phone: '9999999999',
    legal_business_name: 'Route capability probe',
    business_type: 'individual',
    contact_name: 'Probe',
    profile: {
      category: (process.env.RAZORPAY_LINKED_CATEGORY ?? 'education').trim(),
      subcategory: (process.env.RAZORPAY_LINKED_SUBCATEGORY ?? 'elearning').trim(),
      addresses: { registered: { street1: 'probe', street2: 'probe', city: 'probe', state: 'probe', postal_code: '560001', country: 'IN' } },
    },
  } as any);
  console.log('seller onboarding: UNEXPECTED — the probe was meant to fail validation; check for a stray linked account');
} catch (e) {
  const message = describe(e);
  // A field-validation complaint means the endpoint is ours to call. "Access Denied"
  // means linked-account creation is switched off for this account.
  onboardOk = !/access denied/i.test(message);
  console.log(`seller onboarding: ${onboardOk ? 'AVAILABLE' : 'NOT AVAILABLE'} — ${message}`);
}

console.log();
if (splitOk && onboardOk) {
  console.log('Route is live. Sellers can be onboarded from /sell/payouts and paid sales will split.');
  console.log('Set RAZORPAY_ROUTE=on (or leave it unset) and run a real low-value sale end to end.');
} else {
  console.log('Route is NOT available on this account. Paid checkout will fail while RAZORPAY_ROUTE is on.');
  console.log('Set RAZORPAY_ROUTE=off: payments land wholly in the platform account, sellers can still');
  console.log('list and sell, and purchases still records each seller\'s net for you to pay out yourself.');
  console.log('See RAZORPAY_SETUP_GUIDE_LIVE_FOR_SUB_MERCHANT.md section 2 for the eligibility bar.');
}
