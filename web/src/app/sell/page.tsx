'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, StatusPill, VaultRow } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { PLATFORM_FEE_PERCENT } from '@/lib/config';
import { formatCount, formatPrice } from '@/lib/format';
import { useAuth } from '@/store/auth';
import type { PayoutState, Vault, VaultStatus } from '@/types';

export default function SellPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Sell />
    </Suspense>
  );
}

function Sell() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, profile, refreshProfile, isDemo, loading } = useAuth();
  const isSeller = !!profile?.isSeller;

  const vaults = useAsync(() => (user && isSeller ? api.getMyVaults() : Promise.resolve([])), [user?.id, isSeller]);
  const stats = useAsync(() => (user && isSeller ? api.getSellerStats() : Promise.resolve(null)), [user?.id, isSeller]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Razorpay's verdict, which the profile flag cannot carry: "not activated" covers both
  // waiting on Razorpay and waiting on the seller, and only the second is actionable.
  const [payout, setPayout] = useState<PayoutState | null>(null);

  // Razorpay reviews linked accounts asynchronously; sync the flag when the page opens or after saving details.
  useEffect(() => {
    if (user && isSeller && !profile?.payoutsEnabled && !isDemo) {
      api
        .refreshPayoutStatus()
        .then((state) => {
          setPayout(state);
          return refreshProfile();
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isSeller, profile?.payoutsEnabled, params.get('payouts')]);

  const onBecomeSeller = () => router.push(user ? '/sell/payouts' : '/auth?next=/sell/payouts');

  const onCheckStatus = async () => {
    setChecking(true);
    setError(null);
    try {
      const state = await api.refreshPayoutStatus();
      setPayout(state);
      await refreshProfile();
      if (state.status === 'needs_clarification') setError('Razorpay needs something from you before it can activate payouts. See below.');
      else if (state.status === 'suspended') setError('Razorpay has suspended this linked account. Contact Razorpay support to reinstate it.');
      else if (state.status !== 'activated') setError('Razorpay is still verifying your details. Free vaults can be published meanwhile.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const toggleStatus = async (v: Vault) => {
    const next: VaultStatus = v.status === 'published' ? 'unlisted' : 'published';
    if (next === 'published' && !v.filePath) {
      setError('Upload the vault .zip before publishing.');
      return;
    }
    try {
      await api.setVaultStatus(v.id, next);
      await Promise.all([vaults.refresh(), stats.refresh()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const onDelete = async (v: Vault) => {
    if (!window.confirm(`Delete "${v.title}"? Buyers keep access to what they already bought.`)) return;
    try {
      await api.deleteVault(v.id);
      await vaults.refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (loading) return <Loading />;

  if (!isSeller) {
    return (
      <div className="stack" style={{ gap: 24 }}>
        <div>
          <h1>Sell your vault</h1>
          <p className="muted">Turn the Obsidian vault you already maintain into income. List it at your price, we handle checkout, delivery and MCP access.</p>
        </div>
        <div className="perks">
          <Perk title={`Keep ${100 - PLATFORM_FEE_PERCENT}% of every sale`} body={`A flat ${PLATFORM_FEE_PERCENT}% only when you sell. Free vaults cost nothing to list.`} />
          <Perk title="Payouts by Razorpay" body="Buyers pay with UPI, cards or netbanking. Your share settles to your bank account through Razorpay Route." />
          <Perk title="Upload a zip, that is it" body="Export your vault folder as a .zip, add a description and a cover, publish." />
          <Perk title="Download or MCP" body="Buyers unzip into Obsidian or connect the vault to their AI assistant. You do nothing extra." />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div>
          <button className="btn" onClick={onBecomeSeller}>
            {user ? 'Become a seller' : 'Sign in to start selling'}
          </button>
          {!isDemo ? <p className="help" style={{ marginTop: 8 }}>You enter your PAN, address and bank account once. Razorpay verifies them in a day or two.</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <h1>Seller dashboard</h1>
        <Link href="/sell/new" className="btn">
          New listing
        </Link>
      </div>

      {!profile?.payoutsEnabled && !isDemo ? (
        <div className="notice row between">
          <span>
            {!profile?.razorpayAccountId
              ? 'Add your payout details to sell paid vaults.'
              : payout?.status === 'needs_clarification'
                ? 'Razorpay needs more information before payouts can be activated.'
                : payout?.status === 'suspended'
                  ? 'Razorpay has suspended your linked account, so paid vaults cannot be sold.'
                  : 'Payouts pending Razorpay review. Paid vaults unlock once your linked account is activated.'}
          </span>
          {profile?.razorpayAccountId ? (
            <span className="row">
              <button className="btn small secondary" onClick={onCheckStatus} disabled={checking}>
                {checking ? 'Checking…' : 'Re-check'}
              </button>
              <Link href="/sell/payouts" className="btn small secondary">
                Edit bank details
              </Link>
            </span>
          ) : (
            <button className="btn small" onClick={onBecomeSeller}>
              Add details
            </button>
          )}
        </div>
      ) : null}
      {/* What Razorpay is waiting for. Without this the seller sees "pending" forever
          with nothing to act on, which is the state that leaves accounts stuck. */}
      {payout?.requirements?.length ? (
        <div className="notice stack" style={{ gap: 8 }}>
          <strong>Razorpay still needs:</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {payout.requirements.map((r) => (
              <li key={`${r.field}-${r.reason}`}>
                <code>{r.field}</code> — {r.reason.replace(/_/g, ' ')}
                {r.resolutionUrl ? (
                  <>
                    {' '}
                    <a href={r.resolutionUrl} target="_blank" rel="noreferrer">
                      resolve
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <span className="muted small">Update the affected details on this page, then re-check.</span>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      {stats.data ? (
        <div className="stats">
          <div className="stat accent">
            <div className="label">Net earnings</div>
            <div className="value">{formatPrice(stats.data.netCents)}</div>
          </div>
          <div className="stat">
            <div className="label">Sales</div>
            <div className="value">{stats.data.salesCount}</div>
          </div>
          <div className="stat">
            <div className="label">Downloads</div>
            <div className="value">{formatCount(stats.data.downloads)}</div>
          </div>
          <div className="stat">
            <div className="label">Published</div>
            <div className="value">{stats.data.publishedCount}</div>
          </div>
        </div>
      ) : stats.loading ? (
        <Loading />
      ) : null}

      <section className="stack">
        <h2>Your listings</h2>
        {vaults.error ? <ErrorBox message={vaults.error} onRetry={vaults.refresh} /> : null}
        {vaults.loading && !vaults.data ? <Loading /> : null}
        {vaults.data && vaults.data.length === 0 ? (
          <Empty
            title="No listings yet"
            message="Create your first listing. Save it as a draft and publish when the zip is ready."
            action={
              <Link href="/sell/new" className="btn">
                New listing
              </Link>
            }
          />
        ) : null}
        {vaults.data?.map((v) => (
          <div key={v.id} className="stack" style={{ gap: 8 }}>
            <VaultRow
              vault={v}
              href={`/sell/${v.id}`}
              right={
                <div className="row">
                  <StatusPill status={v.status} />
                  <span className="price">{formatPrice(v.priceCents, v.currency)}</span>
                </div>
              }
            />
            <div className="row" style={{ paddingLeft: 4 }}>
              <button className="btn small secondary" onClick={() => toggleStatus(v)}>
                {v.status === 'published' ? 'Unlist' : 'Publish'}
              </button>
              <Link href={`/sell/${v.id}`} className="btn small secondary">
                Edit
              </Link>
              <button className="btn small danger" onClick={() => onDelete(v)}>
                Delete
              </button>
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                {formatCount(v.downloads)} downloads
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function Perk({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p className="muted small" style={{ marginTop: 4 }}>
        {body}
      </p>
    </div>
  );
}
