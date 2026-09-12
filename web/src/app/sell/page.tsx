'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, StatusPill, VaultRow } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { PLATFORM_FEE_FIXED_CENTS, PLATFORM_FEE_PERCENT_DOMESTIC, PLATFORM_FEE_PERCENT_INTERNATIONAL } from '@/lib/config';
import { formatCount, formatPrice } from '@/lib/format';
import { useAuth } from '@/store/auth';
import type { Vault, VaultStatus } from '@/types';

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
  // Dodo settles to the platform and never pays a seller, so a paid listing can only go
  // live once we know where to send their share.
  const payout = useAsync(
    () => (user && isSeller && !isDemo ? api.getPayoutDetails() : Promise.resolve({ details: null, currencies: [] })),
    [user?.id, isSeller]
  );
  const payoutMissing = !isDemo && isSeller && !payout.loading && !payout.data?.details;
  const stats = useAsync(() => (user && isSeller ? api.getSellerStats() : Promise.resolve(null)), [user?.id, isSeller]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selling used to require payout onboarding — a linked account, KYC and
  // bank details — before a paid vault could be listed. The platform is now the seller of
  // record, so a creator just opts in and lists; their royalty is settled outside checkout.
  const onBecomeSeller = async () => {
    if (!user) return router.push('/auth?next=/sell');
    setJoining(true);
    setError(null);
    try {
      await api.updateProfile({ isSeller: true });
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
          <Perk
            title="Keep most of every sale"
            body={`${PLATFORM_FEE_PERCENT_DOMESTIC}% + ${formatPrice(PLATFORM_FEE_FIXED_CENTS)} per sale if you are paid in India, ${PLATFORM_FEE_PERCENT_INTERNATIONAL}% + ${formatPrice(PLATFORM_FEE_FIXED_CENTS)} elsewhere, because sending money abroad costs more. Only when you sell, and free vaults cost nothing to list.`}
          />
          <Perk title="Paid worldwide" body="Buyers pay in their own currency and we handle the tax. Your share is settled to you separately." />
          <Perk title="Upload a zip, that is it" body="Export your vault folder as a .zip, add a description and a cover, publish." />
          <Perk title="Download or MCP" body="Buyers unzip into Obsidian or connect the vault to their AI assistant. You do nothing extra." />
        </div>
        {error ? <div className="error">{error}</div> : null}
        <div>
          <button className="btn" onClick={onBecomeSeller}>
            {user ? 'Become a seller' : 'Sign in to start selling'}
          </button>
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

      {!isSeller && !isDemo ? (
        <div className="notice row between">
          <span>Turn on selling to list your vaults. Buyers are charged by Vault Market; your share is settled separately.</span>
          <button className="btn small" onClick={onBecomeSeller} disabled={joining}>
            {joining ? 'Enabling…' : 'Start selling'}
          </button>
        </div>
      ) : null}

      {payoutMissing ? (
        <div className="notice row between">
          <span>Add your payout details to publish paid vaults. Free vaults can go live without them.</span>
          <Link href="/sell/payouts" className="btn small">
            Add details
          </Link>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      {stats.data ? (
        <div className="stats">
          <div className="stat accent">
            <div className="label">Net earnings</div>
            <div className="value">{formatPrice(stats.data.netCents)}</div>
          </div>
          {/* Earned and paid are separate events: the platform transfers a balance once it is
              worth the transfer fee, so a seller should see where they stand. */}
          {stats.data.outstandingCents !== undefined ? (
            <div className="stat">
              <div className="label">Awaiting payout</div>
              <div className="value">{formatPrice(stats.data.outstandingCents)}</div>
              {stats.data.payoutThresholdCents ? (
                <div className="label" style={{ marginTop: 4 }}>
                  {stats.data.outstandingCents >= stats.data.payoutThresholdCents
                    ? 'Ready to be sent'
                    : `Sent once you reach ${formatPrice(stats.data.payoutThresholdCents)}`}
                </div>
              ) : null}
            </div>
          ) : null}
          {stats.data.paidOutCents ? (
            <div className="stat">
              <div className="label">Paid out</div>
              <div className="value">{formatPrice(stats.data.paidOutCents)}</div>
            </div>
          ) : null}
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
