'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, Field, Loading, Toast } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { PLATFORM_COUNTRY, PLATFORM_FEE_FIXED_CENTS, feePercentFor } from '@/lib/config';
import { formatPrice } from '@/lib/format';
import { errorMessage } from '@/lib/web';
import { useAuth } from '@/store/auth';
import type { PayoutDetails, PayoutMethod } from '@/types';

const METHODS: { value: PayoutMethod; label: string; hint: string }[] = [
  { value: 'bank', label: 'Bank transfer', hint: 'Account number or IBAN, plus the local code your bank uses.' },
  { value: 'wise', label: 'Wise', hint: 'The email address on your Wise account.' },
  { value: 'payoneer', label: 'Payoneer', hint: 'The email address on your Payoneer account.' },
  { value: 'paypal', label: 'PayPal', hint: 'The email address on your PayPal account.' },
];

/**
 * Sending money costs something, and it varies enormously by route: a transfer inside India
 * is nearly free while an international bank wire is not. Rather than absorb that quietly,
 * the cheaper routes simply pay out sooner, so the choice is worth showing before it is made.
 */
const PAYOUT_SPEED: Record<PayoutMethod, string> = {
  bank: 'Inside India this is the cheapest route and pays out soonest. To another country it is a wire, which is the most expensive and pays out last.',
  wise: 'Cheap internationally, so you are paid well before an international bank transfer would reach you.',
  payoneer: 'Cheap internationally, so you are paid well before an international bank transfer would reach you.',
  paypal: 'Cheap internationally. Note PayPal takes its own cut from what arrives.',
};

const EMPTY: PayoutDetails = { country: '', currency: '', method: 'bank', accountName: '', accountRef: '', bankCode: '', notes: '' };

/**
 * Where the seller's share is sent. This is not an onboarding to the payment provider:
 * Dodo is the merchant of record, settles one amount to the platform and never pays a
 * seller, so the platform pays them and needs to know where.
 */
export default function PayoutDetailsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [form, setForm] = useState<PayoutDetails>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = useAsync(() => (user ? api.getPayoutDetails() : Promise.resolve({ details: null, currencies: [] })), [user?.id]);

  useEffect(() => {
    if (existing.data?.details) setForm({ ...EMPTY, ...existing.data.details });
  }, [existing.data]);

  if (loading || (user && existing.loading && !existing.data)) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to set up payouts"
        action={
          <Link href="/auth?next=/sell/payouts" className="btn">
            Sign in
          </Link>
        }
      />
    );
  }

  const currencies = existing.data?.currencies ?? [];
  const method = METHODS.find((m) => m.value === form.method)!;
  const isBank = form.method === 'bank';

  const set = (patch: Partial<PayoutDetails>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.savePayoutDetails(form);
      setSaved(true);
      router.push('/sell');
    } catch (err) {
      // The server validates the same fields and phrases the reason for the seller.
      setError(errorMessage(err, 'Could not save your payout details.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="narrow stack" style={{ margin: '0 auto', gap: 16 }}>
      <div>
        <h1>Payout details</h1>
        <p className="muted">
          Buyers pay Vault Market, which is the seller of record for every sale and handles the tax. Your share, the price less our{' '}
          {feePercentFor(form.country)}% + {formatPrice(PLATFORM_FEE_FIXED_CENTS)} fee, is sent to you separately, so we need to know where. A paid
          vault cannot go live until this is filled in; free vaults can be published without it.
        </p>
      </div>

      <form className="card stack" onSubmit={submit}>
        <Field
          label="Country"
          hint={
            form.country.length === 2
              ? `Paid in ${form.country}, your rate is ${feePercentFor(form.country)}% + ${formatPrice(PLATFORM_FEE_FIXED_CENTS)} per sale.`
              : `Two-letter code for where your account is held, for example ${PLATFORM_COUNTRY}, US or DE. It sets your rate: sending money abroad costs more.`
          }
        >
          <input
            className="input"
            value={form.country}
            onChange={(e) => set({ country: e.target.value.toUpperCase().slice(0, 2) })}
            placeholder="IN"
            style={{ textTransform: 'uppercase' }}
            maxLength={2}
          />
        </Field>

        <Field label="Currency" hint="What you want to receive. If yours is missing we cannot pay out in it yet.">
          <select className="input" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
            <option value="">Select a currency</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How you want to be paid" hint={PAYOUT_SPEED[form.method]}>
          <select className="input" value={form.method} onChange={(e) => set({ method: e.target.value as PayoutMethod, accountRef: '' })}>
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Account holder name" hint="Exactly as it appears on the account. A mismatch is the usual reason a transfer bounces.">
          <input className="input" value={form.accountName} onChange={(e) => set({ accountName: e.target.value })} placeholder="Your full name" />
        </Field>

        <Field label={isBank ? 'Account number or IBAN' : 'Account email'} hint={method.hint}>
          <input
            className="input"
            value={form.accountRef}
            onChange={(e) => set({ accountRef: e.target.value })}
            placeholder={isBank ? '00000000000' : 'you@example.com'}
            inputMode={isBank ? 'numeric' : 'email'}
          />
        </Field>

        {isBank ? (
          <Field label="Bank code" hint="IFSC in India, sort code in the UK, routing number in the US, or SWIFT/BIC.">
            <input className="input" value={form.bankCode ?? ''} onChange={(e) => set({ bankCode: e.target.value })} placeholder="SBIN0001234" />
          </Field>
        ) : null}

        <Field label="Anything we should know" hint="Optional. An intermediary bank, a branch, or a note about the account.">
          <input className="input" value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional" />
        </Field>

        {error ? <div className="error">{error}</div> : null}

        <div className="row">
          <button className="btn" disabled={saving}>
            {saving ? 'Saving…' : existing.data?.details ? 'Update payout details' : 'Save payout details'}
          </button>
          <Link href="/sell" className="btn ghost">
            Cancel
          </Link>
        </div>
      </form>

      <p className="muted small">
        Earnings build up and are sent once they are worth transferring, because every transfer costs a fee and a tiny payout would
        be mostly fee. Cheaper routes reach that point sooner. A sale also clears for a few days first, longer for buyers in the EU,
        EEA or UK who have a statutory right to withdraw, so that a reversed payment is never one we have already paid out. Your seller dashboard shows how far along you are. These details are
        stored for paying you and are never shown publicly or shared with buyers.
      </p>

      {saved ? <Toast title="Payout details saved" message="You can now publish paid vaults." onClose={() => setSaved(false)} /> : null}
    </div>
  );
}
