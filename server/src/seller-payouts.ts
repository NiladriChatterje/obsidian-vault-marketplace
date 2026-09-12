/**
 * Where a seller's share is sent. Dodo settles one amount to the platform and has no
 * sub-merchant concept, so paying creators is the platform's own job and these are the
 * platform's own records.
 *
 * `hasPayoutDetails` is the gate: a paid listing cannot be published, and cannot be bought,
 * unless the seller can actually be paid.
 */
import { IS_DEMO } from './config.ts';
import { isPayoutCurrency } from './payout-currencies.ts';
import { admin } from './supabase.ts';

export type PayoutMethod = 'bank' | 'wise' | 'payoneer' | 'paypal';

export interface PayoutDetails {
  country: string;
  currency: string;
  method: PayoutMethod;
  accountName: string;
  accountRef: string;
  bankCode?: string | null;
  notes?: string | null;
}

const METHODS: PayoutMethod[] = ['bank', 'wise', 'payoneer', 'paypal'];

type Row = Record<string, any>;

const fromRow = (r: Row): PayoutDetails => ({
  country: r.country,
  currency: r.currency,
  method: r.method,
  accountName: r.account_name,
  accountRef: r.account_ref,
  bankCode: r.bank_code ?? null,
  notes: r.notes ?? null,
});

export async function getPayoutDetails(userId: string): Promise<PayoutDetails | null> {
  if (IS_DEMO) return null;
  const { data, error } = await admin().from('seller_payouts').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

/**
 * Demo mode has no database and grants purchases in the client, so there is no one to pay
 * and nothing to gate. Everywhere else, a seller must be payable.
 */
export async function hasPayoutDetails(userId: string): Promise<boolean> {
  if (IS_DEMO) return true;
  const { data, error } = await admin().from('seller_payouts').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

/**
 * Whether the seller can be paid, and where they bank. The country sets the commission
 * rate, so checkout needs both and should not ask twice.
 */
export async function payoutRegion(userId: string): Promise<{ has: boolean; country: string | null }> {
  if (IS_DEMO) return { has: true, country: null };
  const { data, error } = await admin().from('seller_payouts').select('country').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return { has: !!data, country: data?.country ?? null };
}

/** Returns the problem as a sentence for the seller, or null when the details are usable. */
export function validatePayoutDetails(d: Partial<PayoutDetails>): string | null {
  const country = (d.country ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return 'Choose the country your account is held in.';

  const currency = (d.currency ?? '').trim().toUpperCase();
  if (!currency) return 'Choose the currency you want to be paid in.';
  if (!isPayoutCurrency(currency)) {
    return `We cannot pay out in ${currency} yet. Pick another currency you can receive, such as USD or EUR, or contact support.`;
  }

  if (!d.method || !METHODS.includes(d.method)) return 'Choose how you want to be paid.';
  if (!(d.accountName ?? '').trim()) return 'Enter the name on the receiving account.';

  const ref = (d.accountRef ?? '').trim();
  if (!ref) return d.method === 'bank' ? 'Enter your account number or IBAN.' : 'Enter the email address on that account.';
  // The transfer services are addressed by email; a bank is not, and confusing the two is
  // the most common way these forms are filled in wrongly.
  const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ref);
  if (d.method !== 'bank' && !looksLikeEmail) return 'That does not look like an email address. Transfer services are addressed by the account email.';
  if (d.method === 'bank' && looksLikeEmail) return 'Enter the account number or IBAN here, not an email address.';

  return null;
}

export async function savePayoutDetails(userId: string, d: PayoutDetails): Promise<PayoutDetails> {
  const row = {
    user_id: userId,
    country: d.country.trim().toUpperCase(),
    currency: d.currency.trim().toUpperCase(),
    method: d.method,
    account_name: d.accountName.trim(),
    account_ref: d.accountRef.trim(),
    bank_code: d.bankCode?.trim() || null,
    notes: d.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin().from('seller_payouts').upsert(row, { onConflict: 'user_id' }).select('*').single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}
