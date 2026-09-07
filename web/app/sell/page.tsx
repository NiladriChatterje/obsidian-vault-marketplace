'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, StatusPill, VaultRow } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@shared/hooks/useAsync';
import { api } from '@shared/lib/api';
import { PLATFORM_FEE_PERCENT } from '@shared/lib/config';
import { formatCount, formatPrice } from '@shared/lib/format';
import { useAuth } from '@shared/store/auth';
import type { Vault, VaultStatus } from '@shared/types';

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
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Back from Stripe Express onboarding (return_url = /sell?onboarding=done).
  useEffect(() => {
    if (params.get('onboarding')) refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('onboarding')]);

  const onBecomeSeller = async () => {
    if (!user) {
      router.push('/auth?next=/sell');
      return;
    }
    setJoining(true);
    setError(null);
    try {
      const { onboardingUrl } = await api.becomeSeller();
      if (onboardingUrl) {
        window.location.assign(onboardingUrl);
        return;
      }
      await refreshProfile();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setJoining(false);
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
          <Perk title="Payouts by Stripe" body="Stripe Express handles taxes, identity and bank transfers in 40+ countries." />
          <Perk title="Upload a zip, that is it" body="Export your vault folder as a .zip, add a description and a cover, publish." />
          <Perk title="Download or MCP" body="Buyers unzip into Obsidian or connect the vault to their AI assistant. You do nothing extra." />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div>
          <button className="btn" onClick={onBecomeSeller} disabled={joining}>
            {joining ? 'Starting…' : user ? 'Become a seller' : 'Sign in to start selling'}
          </button>
          {!isDemo ? <p className="help" style={{ marginTop: 8 }}>You will be redirected to Stripe to set up payouts. It takes about 5 minutes.</p> : null}
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

      {!profile?.stripeOnboarded && !isDemo ? (
        <button className="notice" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={onBecomeSeller}>
          Finish Stripe setup to receive payouts. Click to continue.
        </button>
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
