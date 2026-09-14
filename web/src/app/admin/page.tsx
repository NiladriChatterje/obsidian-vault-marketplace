'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Empty, ErrorBox, Loading, Price, Stars, StatusPill } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { formatCount, formatMoney, formatPrice, timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';

/**
 * The operator's view of the marketplace: what has been bought, how each vault is doing and
 * who bought most recently. Every vault is a link to its buyers and reviews in full.
 *
 * Who may see this is decided by the server, from ADMIN_USER_IDS. The page only asks.
 */
export default function AdminPage() {
  const router = useRouter();
  const { user, loading, isAdmin, isDemo } = useAuth();
  const overview = useAsync(() => (user && isAdmin ? api.getAdminOverview() : Promise.resolve(null)), [user?.id, isAdmin]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to open the dashboard"
        action={
          <Link href="/auth?next=/admin" className="btn">
            Sign in
          </Link>
        }
      />
    );
  }
  if (!isAdmin) {
    return (
      <Empty
        title="Not an administrator"
        message="This dashboard is for the people named in ADMIN_USER_IDS on the server. If that should include you, add your user id there and restart the server."
      />
    );
  }

  const o = overview.data;
  const t = o?.totals;
  const currency = t?.currency;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row between wrap">
        <div>
          <h1>Dashboard</h1>
          <p className="muted small">
            Every purchase across the marketplace, and how each vault is doing. What is owed to whom is the payout ledger, <span className="mono">/admin/payouts</span> on the server.
          </p>
        </div>
        <div className="row wrap">
          {isDemo ? <span className="demo-pill">DEMO</span> : null}
          <button className="btn small secondary" onClick={overview.refresh} disabled={overview.loading}>
            {overview.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {overview.error ? <ErrorBox message={overview.error} onRetry={overview.refresh} /> : null}
      {overview.loading && !o ? <Loading /> : null}

      {t ? (
        <div className="stats">
          <div className="stat accent">
            <div className="label">Purchases</div>
            <div className="value">{formatCount(t.purchases)}</div>
            <div className="label" style={{ marginTop: 4, fontWeight: 400 }}>
              {formatCount(t.sales)} paid, {formatCount(t.purchases - t.sales)} free
            </div>
          </div>
          <div className="stat">
            <div className="label">Buyers</div>
            <div className="value">{formatCount(t.buyers)}</div>
          </div>
          <div className="stat">
            <div className="label">Sellers</div>
            <div className="value">{formatCount(t.sellers)}</div>
          </div>
          <div className="stat">
            <div className="label">Vaults</div>
            <div className="value">{formatCount(t.vaults)}</div>
          </div>
          <div className="stat">
            <div className="label">Sales total</div>
            <div className="value">{formatMoney(t.grossCents, currency)}</div>
          </div>
          <div className="stat">
            <div className="label">Platform fees</div>
            <div className="value">{formatMoney(t.feeCents, currency)}</div>
          </div>
          <div className="stat">
            <div className="label">Sellers' share</div>
            <div className="value">{formatMoney(t.netCents, currency)}</div>
            <div className="label" style={{ marginTop: 4, fontWeight: 400 }}>
              Owed or paid to sellers
            </div>
          </div>
        </div>
      ) : null}

      {o ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2>Vaults</h2>
          {o.vaults.length === 0 ? <Empty title="No vaults yet" message="Listings appear here as sellers publish them." /> : null}
          {o.vaults.length ? (
            <div className="table-wrap">
              <table className="table clickable">
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Status</th>
                    <th className="num">Price</th>
                    <th className="num">Buyers</th>
                    <th className="num">Paid</th>
                    <th className="num">Sales total</th>
                    <th className="num">Fee</th>
                    <th>Rating</th>
                    <th>Last purchase</th>
                  </tr>
                </thead>
                <tbody>
                  {o.vaults.map((row) => {
                    const v = row.vault;
                    const href = `/admin/vaults/${encodeURIComponent(row.vaultId)}`;
                    return (
                      <tr key={row.vaultId} onClick={() => router.push(href)}>
                        <td>
                          <Link href={href} className="table-title">
                            {v?.title ?? <span className="muted">Removed vault</span>}
                          </Link>
                          <div className="muted small truncate">{v?.seller?.displayName ?? (v ? '' : row.vaultId)}</div>
                        </td>
                        <td>{v ? <StatusPill status={v.status} /> : <span className="pill">Deleted</span>}</td>
                        <td className="num">{v ? <Price cents={v.priceCents} currency={v.currency} /> : '—'}</td>
                        <td className="num">
                          <strong>{formatCount(row.sales.buyers)}</strong>
                        </td>
                        <td className="num">{formatCount(row.sales.sales)}</td>
                        <td className="num">{formatMoney(row.sales.grossCents, v?.currency ?? currency)}</td>
                        <td className="num">{formatMoney(row.sales.feeCents, v?.currency ?? currency)}</td>
                        <td>{v && v.ratingCount > 0 ? <Stars value={v.ratingAvg} count={v.ratingCount} /> : <span className="muted small">—</span>}</td>
                        <td className="muted small">{row.sales.lastPurchaseAt ? timeAgo(row.sales.lastPurchaseAt) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      ) : null}

      {o ? (
        <section className="stack" style={{ gap: 12 }}>
          <h2>Recent purchases</h2>
          {o.recent.length === 0 ? <p className="muted">Nothing has been bought yet.</p> : null}
          <div className="stack" style={{ gap: 0 }}>
            {o.recent.map((p) => (
              <div key={p.id} className="feed-row">
                <span className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>
                  {(p.buyer?.displayName ?? '?')[0]?.toUpperCase()}
                </span>
                <span className="grow truncate">
                  <strong>{p.buyer?.displayName ?? 'Deleted account'}</strong>
                  <span className="muted"> {p.amountCents ? 'bought' : 'claimed'} </span>
                  <Link href={`/admin/vaults/${encodeURIComponent(p.vaultId)}`}>{p.vaultTitle ?? 'a removed vault'}</Link>
                </span>
                <span className="num">{formatPrice(p.amountCents, currency)}</span>
                <span className="muted small" title={p.createdAt}>
                  {timeAgo(p.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
