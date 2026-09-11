/**
 * Seller payouts via Razorpay Route linked accounts.
 *   POST /payouts          { details } -> create linked account + stakeholder + Route product + bank details
 *   GET  /payouts/status   re-read activation status and sync profiles.payouts_enabled
 *
 * Both answer { status, requirements }. `requirements` is Razorpay's own list of what
 * it still wants; without it needs_clarification is indistinguishable from waiting.
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO, cfg } from '../config.ts';
import { razorpay, razorpayError } from '../razorpay.ts';
import { recordRouteAvailable, recordRouteFailure } from '../route-status.ts';
import { admin, userFromRequest, type AuthUser } from '../supabase.ts';

interface PayoutDetails {
  legalName: string;
  phone: string;
  pan: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

type Row = Record<string, any>;
/**
 * 'needs_clarification' is split out of 'pending' deliberately: it is the only one the
 * seller can do anything about, and it used to be invisible.
 */
type Status = 'none' | 'pending' | 'needs_clarification' | 'activated' | 'suspended';

/** One thing Razorpay is still waiting for, flattened out of the product's requirements. */
interface Requirement {
  field: string;
  reason: string;
  status: string;
  resolutionUrl?: string;
}

interface PayoutState {
  status: Status;
  requirements: Requirement[];
}

function toRequirements(product: Row | null | undefined): Requirement[] {
  const items: Row[] = Array.isArray(product?.requirements) ? product!.requirements : [];
  return items.map((r) => ({
    field: String(r.field_reference ?? r.field ?? 'details'),
    reason: String(r.reason_code ?? r.reason ?? 'needs_clarification'),
    status: String(r.status ?? 'required'),
    ...(r.resolution_url ? { resolutionUrl: String(r.resolution_url) } : {}),
  }));
}

/** Razorpay's activation_status vocabulary, narrowed to ours. */
function toStatus(activationStatus: unknown): Status {
  switch (activationStatus) {
    case 'activated':
      return 'activated';
    case 'needs_clarification':
      return 'needs_clarification';
    case 'suspended':
      return 'suspended';
    default:
      return 'pending';
  }
}

const str = { type: 'string', minLength: 1 } as const;
const detailsSchema = {
  type: 'object',
  required: ['legalName', 'phone', 'pan', 'street', 'city', 'state', 'postalCode', 'accountNumber', 'ifsc', 'beneficiaryName'],
  properties: {
    ...Object.fromEntries(['legalName', 'pan', 'street', 'city', 'state', 'postalCode', 'accountNumber', 'ifsc', 'beneficiaryName'].map((k) => [k, str])),
    // Country code is mandatory: E.164 with an optional space/dash formatting already stripped by the client.
    phone: { type: 'string', pattern: '^\\+[1-9][0-9]{7,14}$' },
  },
};

/**
 * Razorpay linked accounts expect the national number for Indian sellers
 * (10 digits) and digits without "+" otherwise.
 */
function razorpayPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

export default async function payoutRoutes(app: FastifyInstance) {
  app.post<{ Body: { details: PayoutDetails } }>(
    '/payouts',
    { schema: { body: { type: 'object', required: ['details'], properties: { details: detailsSchema } } } },
    async (req, reply) => {
      if (IS_DEMO) return reply.code(501).send({ error: 'Payout onboarding needs Supabase configured on the server' });
      const user = await userFromRequest(req);
      if (!user) return reply.code(401).send({ error: 'Not signed in' });
      try {
        return await onboard(user, req.body.details);
      } catch (e) {
        req.log.error(e);
        const message = razorpayError(e);
        // Creating a linked account is the other call that proves Route either way.
        recordRouteFailure(message);
        return reply.code(502).send({ error: message });
      }
    }
  );

  app.get('/payouts/status', async (req, reply) => {
    if (IS_DEMO) return { status: 'none' as Status, requirements: [] as Requirement[] };
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    try {
      return await onboard(user);
    } catch (e) {
      req.log.error(e);
      const message = razorpayError(e);
      recordRouteFailure(message);
      return reply.code(502).send({ error: message });
    }
  });
}

async function onboard(user: AuthUser, details?: PayoutDetails): Promise<PayoutState> {
  const db = admin();
  const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();
  if (error || !profile) throw new Error('Profile not found');

  let accountId: string | null = profile.razorpay_account_id;
  let productId: string | null = profile.razorpay_product_id;

  const phone = details ? razorpayPhone(details.phone) : '';
  const pan = details ? details.pan.toUpperCase() : '';

  if (!accountId) {
    if (!details) return { status: 'none', requirements: [] };

    const account = (await razorpay.accounts.create({
      email: user.email ?? undefined,
      phone,
      legal_business_name: details.legalName,
      customer_facing_business_name: profile.display_name ?? details.legalName,
      business_type: 'individual',
      contact_name: details.legalName,
      profile: {
        category: cfg.razorpay.linkedCategory,
        subcategory: cfg.razorpay.linkedSubcategory,
        addresses: {
          registered: { street1: details.street, street2: details.city, city: details.city, state: details.state, postal_code: details.postalCode, country: 'IN' },
        },
      },
      legal_info: { pan },
      notes: { user_id: user.id },
    } as any)) as Row;
    accountId = account.id;
    recordRouteAvailable();
    // Save the id before anything else can fail: the account now exists at
    // Razorpay and a second create for the same email is rejected, so dropping
    // it here would strand the seller permanently.
    await db.from('profiles').update({ is_seller: true, razorpay_account_id: accountId }).eq('id', user.id);
  }

  // Also the resume path for a submission that died after the account was
  // created - most often because the platform has no Route access yet.
  if (details && !productId) {
    const { items = [] } = (await razorpay.stakeholders.all(accountId!)) as Row;
    if (!items.length) {
      await razorpay.stakeholders.create(accountId!, {
        name: details.legalName,
        email: user.email ?? undefined,
        percentage_ownership: 100,
        relationship: { executive: true },
        phone: { primary: phone },
        addresses: { residential: { street: details.street, city: details.city, state: details.state, postal_code: details.postalCode, country: 'IN' } },
        kyc: { pan },
      } as any);
    }

    const product = (await razorpay.products.requestProductConfiguration(accountId!, { product_name: 'route', tnc_accepted: true })) as Row;
    productId = product.id;
    await db.from('profiles').update({ razorpay_product_id: productId }).eq('id', user.id);
  }

  if (details && productId) {
    await razorpay.products.edit(accountId!, productId, {
      settlements: { account_number: details.accountNumber, ifsc_code: details.ifsc.toUpperCase(), beneficiary_name: details.beneficiaryName },
      tnc_accepted: true,
    } as any);
  }

  let status: Status = 'pending';
  let requirements: Requirement[] = [];
  let activationStatus: string | null = null;
  if (productId) {
    const product = (await razorpay.products.fetch(accountId!, productId)) as Row;
    activationStatus = product.activation_status ?? null;
    status = toStatus(activationStatus);
    requirements = status === 'activated' ? [] : toRequirements(product);
  }
  await db
    .from('profiles')
    .update({
      is_seller: true,
      payouts_enabled: status === 'activated',
      razorpay_payout_status: activationStatus,
      razorpay_requirements: requirements.length ? requirements : null,
    })
    .eq('id', user.id);
  return { status, requirements };
}
