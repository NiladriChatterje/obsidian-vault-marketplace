'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Empty, ErrorBox, Loading, StatusPill, VaultRow } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { MAX_SELLER_STORAGE_BYTES, PLATFORM_FEE_FIXED_CENTS, PLATFORM_FEE_PERCENT_DOMESTIC, PLATFORM_FEE_PERCENT_INTERNATIONAL } from '@/lib/config';
import { formatBytes, formatCount, formatDate, formatMoney, formatPrice } from '@/lib/format';
import { useAuth } from '@/store/auth';
import type { Vault, VaultSales, VaultStatus } from '@/types';

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
  const { user, profile, refreshProfile, setMode, isDemo, loading } = useAuth();
  const isSeller = !!profile?.isSeller;

  const vaults = useAsync(() => (user && isSeller ? api.getMyVaults() : Promise.resolve([])), [user?.id, isSeller]);
  // Dodo settles to the platform and never pays a seller, so a paid listing can only go
  // live once we know where to send their share.
  const payout = useAsync(
    () => (user && isSeller && !isDemo ? api.getPayoutDetails() : Promise.resolve({ details: null, currencies: [], terms: null })),
    [user?.id, isSeller]
  );
  const payoutMissing = !isDemo && isSeller && !payout.loading && !payout.data?.details;
  const stats = useAsync(() => (user && isSeller ? api.getSellerStats() : Promise.resolve(null)), [user?.id, isSeller]);
  // How each listing has sold, so the store shows buyers and earnings per vault, not just in total.
  const insights = useAsync(() => (user && isSeller ? api.getMyInsights() : Promise.resolve([])), [user?.id, isSeller]);
  const salesById = new Map((insights.data ?? []).map((s) => [s.vaultId, s]));
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
      setMode('seller');
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
      <div className="row between wrap">
        <div>
          <h1>Your store</h1>
          <p className="muted small">Your listings, who bought them and what you have earned.</p>
        </div>
        <div className="row wrap">
          {user ? (
            <Link href={`/seller/${user.id}`} className="btn secondary">
              Public storefront
            </Link>
          ) : null}
          <Link href="/sell/new" className="btn">
            New listing
          </Link>
        </div>
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
            <div className="value">{formatMoney(stats.data.netCents)}</div>
          </div>
          {/* Earned and paid are separate events: the platform transfers a balance once it is
              worth the transfer fee, so a seller should see where they stand. */}
          {stats.data.availableCents !== undefined ? (
            <div className="stat">
              <div className="label">Awaiting payout</div>
              <div className="value">{formatMoney(stats.data.availableCents)}</div>
              {/* Payouts go out monthly, so the date matters as much as the threshold: a seller
                  over it is told when, and one under it is told what to reach by then. */}
              {stats.data.payoutThresholdCents ? (
                <div className="label" style={{ marginTop: 4 }}>
                  {stats.data.availableCents >= stats.data.payoutThresholdCents
                    ? stats.data.nextPayoutAt
                      ? `Goes out on ${formatDate(stats.data.nextPayoutAt)}`
                      : 'Ready to be sent'
                    : stats.data.nextPayoutAt
                      ? `Reach ${formatPrice(stats.data.payoutThresholdCents)} to be paid on ${formatDate(stats.data.nextPayoutAt)}`
                      : `Sent once you reach ${formatPrice(stats.data.payoutThresholdCents)}`}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* Recent sales are held until the buyer can no longer reverse them, so a seller
              should see that this money exists rather than wonder where it went. */}
          {stats.data.holdingCents ? (
            <div className="stat">
              <div className="label">Clearing</div>
              <div className="value">{formatMoney(stats.data.holdingCents)}</div>
              <div className="label" style={{ marginTop: 4 }}>Recent sales, payable once they clear</div>
            </div>
          ) : null}
          {stats.data.paidOutCents ? (
            <div className="stat">
              <div className="label">Paid out</div>
              <div className="value">{formatMoney(stats.data.paidOutCents)}</div>
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

      {/* Storage is the one seller limit that is not about money, and the only way to get room
          back is to delete a listing. Shown before the listings so the fix is next to it. */}
      {vaults.data?.length ? (
        <StorageMeter
          usedBytes={stats.data?.storageUsedBytes ?? vaults.data.reduce((s, v) => s + (v.sizeBytes || 0), 0)}
          limitBytes={stats.data?.storageLimitBytes ?? MAX_SELLER_STORAGE_BYTES}
        />
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
              href={`/sell/${v.id}/insights`}
              subtitle={salesLine(v, salesById.get(v.id))}
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
              <Link href={`/sell/${v.id}/insights`} className="btn small secondary">
                Buyers &amp; reviews
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

/**
 * What a listing has done so far, in one line under its title. Falls back to the tagline
 * while the numbers load, so the row never jumps from empty to full.
 */
function salesLine(v: Vault, s: VaultSales | undefined) {
  if (!s) return undefined;
  if (!s.buyers) return <span className="muted">No buyers yet</span>;
  return (
    <>
      {s.buyers} {s.buyers === 1 ? 'buyer' : 'buyers'} · {s.sales} paid · earned {formatMoney(s.netCents, v.currency)}
      {v.ratingCount ? <> · {v.ratingAvg.toFixed(1)} ★ ({v.ratingCount})</> : null}
    </>
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

/**
 * How much of the seller's storage allowance their listings hold. The bar turns to the warning
 * treatment near the top so the squeeze is visible before an upload is refused.
 */
function StorageMeter({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }) {
  const pct = limitBytes > 0 ? Math.min(100, Math.round((usedBytes / limitBytes) * 100)) : 0;
  const freeBytes = Math.max(0, limitBytes - usedBytes);
  const tight = pct >= 85;
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <div className="row between wrap">
        <h3>Storage</h3>
        <span className="muted small">
          {formatBytes(usedBytes)} of {formatBytes(limitBytes)} used
        </span>
      </div>
      <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Storage used">
        <div className={tight ? 'meter-fill tight' : 'meter-fill'} style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {tight
          ? `Only ${formatBytes(freeBytes)} left. Delete a listing you no longer sell to make room for another.`
          : `${formatBytes(freeBytes)} free. Vaults are measured unpacked, so a listing takes more room than its zip.`}
      </p>
    </section>
  );
}
