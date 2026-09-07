/**
 * Seller payouts via Razorpay Route linked accounts.
 *   POST /payouts          { details } -> create linked account + stakeholder + Route product + bank details
 *   GET  /payouts/status   re-read activation status and sync profiles.payouts_enabled
 */
import type { FastifyInstance } from 'fastify';
import { IS_DEMO, cfg } from '../config.ts';
import { razorpay, razorpayError } from '../razorpay.ts';
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
type Status = 'none' | 'pending' | 'activated';

const str = { type: 'string', minLength: 1 } as const;
const detailsSchema = {
  type: 'object',
  required: ['legalName', 'phone', 'pan', 'street', 'city', 'state', 'postalCode', 'accountNumber', 'ifsc', 'beneficiaryName'],
  properties: Object.fromEntries(
    ['legalName', 'phone', 'pan', 'street', 'city', 'state', 'postalCode', 'accountNumber', 'ifsc', 'beneficiaryName'].map((k) => [k, str])
  ),
};

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
        return reply.code(502).send({ error: razorpayError(e) });
      }
    }
  );

  app.get('/payouts/status', async (req, reply) => {
    if (IS_DEMO) return { status: 'none' as Status };
    const user = await userFromRequest(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in' });
    try {
      return await onboard(user);
    } catch (e) {
      req.log.error(e);
      return reply.code(502).send({ error: razorpayError(e) });
    }
  });
}

async function onboard(user: AuthUser, details?: PayoutDetails): Promise<{ status: Status; requirements: unknown[] }> {
  const db = admin();
  const { data: profile, error } = await db.from('profiles').select('*').eq('id', user.id).single();
  if (error || !profile) throw new Error('Profile not found');

  let accountId: string | null = profile.razorpay_account_id;
  let productId: string | null = profile.razorpay_product_id;

  if (!accountId) {
    if (!details) return { status: 'none', requirements: [] };
    const phone = details.phone.replace(/\D/g, '').slice(-10);
    const pan = details.pan.toUpperCase();

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

    await razorpay.stakeholders.create(accountId!, {
      name: details.legalName,
      email: user.email ?? undefined,
      percentage_ownership: 100,
      relationship: { executive: true },
      phone: { primary: phone },
      addresses: { residential: { street: details.street, city: details.city, state: details.state, postal_code: details.postalCode, country: 'IN' } },
      kyc: { pan },
    } as any);

    const product = (await razorpay.products.requestProductConfiguration(accountId!, { product_name: 'route', tnc_accepted: true })) as Row;
    productId = product.id;

    await db.from('profiles').update({ is_seller: true, razorpay_account_id: accountId, razorpay_product_id: productId }).eq('id', user.id);
  }

  if (details && productId) {
    await razorpay.products.edit(accountId!, productId, {
      settlements: { account_number: details.accountNumber, ifsc_code: details.ifsc.toUpperCase(), beneficiary_name: details.beneficiaryName },
      tnc_accepted: true,
    } as any);
  }

  let status: Status = 'pending';
  let requirements: unknown[] = [];
  if (productId) {
    const product = (await razorpay.products.fetch(accountId!, productId)) as Row;
    status = product.activation_status === 'activated' ? 'activated' : 'pending';
    requirements = product.requirements ?? [];
  }
  await db.from('profiles').update({ is_seller: true, payouts_enabled: status === 'activated' }).eq('id', user.id);
  return { status, requirements };
}
