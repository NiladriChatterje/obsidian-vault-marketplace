'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Empty, Field, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { api } from '@/lib/api';
import { PLATFORM_FEE_PERCENT } from '@/lib/config';
import { EMPTY_PAYOUT_DETAILS, PAYOUT_FIELDS, normalizePayoutDetails, validatePayoutDetails } from '@/lib/payouts';
import { useAuth } from '@/store/auth';
import type { PayoutDetails } from '@/types';

/** One-time KYC + bank form that creates the seller's Razorpay Route linked account. */
export default function PayoutsPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile, isDemo } = useAuth();
  const [details, setDetails] = useState<PayoutDetails>({ ...EMPTY_PAYOUT_DETAILS, legalName: profile?.displayName ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validatePayoutDetails(details);
    if (problem) return setError(problem);
    setSaving(true);
    setError(null);
    try {
      const { status } = await api.setupPayouts(normalizePayoutDetails(details));
      await refreshProfile();
      router.push(`/sell?payouts=${status}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="narrow stack" style={{ margin: '0 auto', gap: 16 }}>
      <div>
        <h1>Payout details</h1>
        <p className="muted">
          Buyers pay Vault Market through Razorpay. After each sale your share ({100 - PLATFORM_FEE_PERCENT}%) is transferred to the bank account below via Razorpay Route.
          {isDemo ? ' Demo mode: nothing is sent anywhere.' : ''}
        </p>
      </div>
      <form className="card stack" onSubmit={submit}>
        {PAYOUT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            <input
              className="input"
              value={details[f.key]}
              onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              inputMode={f.keyboard === 'numeric' ? 'numeric' : f.keyboard === 'phone' ? 'tel' : 'text'}
              style={f.key === 'pan' || f.key === 'ifsc' ? { textTransform: 'uppercase' } : undefined}
            />
          </Field>
        ))}
        {error ? <div className="error">{error}</div> : null}
        <div className="row">
          <button className="btn" disabled={saving}>
            {saving ? 'Submitting…' : profile?.razorpayAccountId ? 'Update bank details' : 'Submit for verification'}
          </button>
          <Link href="/sell" className="btn ghost">
            Cancel
          </Link>
        </div>
        <p className="help">Your details go straight to Razorpay and are used only to verify you and settle payouts. Verification usually takes a day or two.</p>
      </form>
    </div>
  );
}
