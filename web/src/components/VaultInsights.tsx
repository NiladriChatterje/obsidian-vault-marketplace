'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Cover, Price, Stars, StatusPill } from '@/components/ui';
import { formatCount, formatDate, formatMoney, formatPrice, timeAgo } from '@/lib/format';
import type { PurchaseRecord, VaultInsights } from '@/types';

type Audience = 'seller' | 'admin';

/**
 * One vault's buyers and reviews, in full. The seller sees it for their own listings and the
 * operator for any; `audience` decides which money is shown. A seller's figure is what they
 * earned, the operator's is what the platform kept and what it owes, and neither reader is
 * helped by the other's columns.
 */
export function VaultInsightsView({ data, audience, back }: { data: VaultInsights; audience: Audience; back: { href: string; label: string } }) {
  const v = data.vault;
  const s = data.sales;
  const currency = v?.currency;
  const admin = audience === 'admin';
  // Bars are relative to the most common rating, so one review still draws a full bar.
  const tallest = Math.max(1, ...data.ratingBreakdown);

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Link href={back.href} className="muted small">
        ← {back.label}
      </Link>

      <div className="insight-head">
        <div className="insight-cover">
          <Cover vault={v ?? { title: 'Removed', coverUrl: null }} />
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <h1>{v?.title ?? 'Removed vault'}</h1>
            {v ? <StatusPill status={v.status} /> : <span className="pill">Deleted</span>}
          </div>
          <p className="muted">{v ? v.tagline : 'This listing is no longer in the catalog. Its purchases and reviews are kept.'}</p>
          <div className="row wrap muted small" style={{ gap: 14 }}>
            {v ? <Price cents={v.priceCents} currency={v.currency} /> : null}
            {v?.seller && admin ? <Link href={`/seller/${v.seller.id}`}>by {v.seller.displayName}</Link> : null}
            {v ? <Link href={`/vault/${v.id}`}>Public page</Link> : null}
            {v && !admin ? <Link href={`/sell/${v.id}`}>Edit listing</Link> : null}
            {v && admin ? <span>Listed {formatDate(v.createdAt)}</span> : null}
          </div>
        </div>
      </div>

      <div className="stats">
        <Stat label="Buyers" value={formatCount(s.buyers)} hint="Distinct people who own it" accent />
        <Stat label="Paid sales" value={formatCount(s.sales)} />
        {s.freeClaims ? <Stat label="Free claims" value={formatCount(s.freeClaims)} /> : null}
        <Stat label="Sales total" value={formatMoney(s.grossCents, currency)} hint="List price of every paid sale" />
        {admin ? (
          <>
            <Stat label="Platform fee" value={formatMoney(s.feeCents, currency)} hint="Kept by the marketplace" />
            <Stat label="Seller's share" value={formatMoney(s.netCents, currency)} hint="Owed or paid to the seller" />
          </>
        ) : (
          <Stat label="You earned" value={formatMoney(s.netCents, currency)} hint="After the platform fee" />
        )}
        {v ? <Stat label="Downloads" value={formatCount(v.downloads)} /> : null}
        <Stat
          label="Rating"
          value={data.ratingCount ? `${data.ratingAvg.toFixed(1)} / 5` : '—'}
          hint={data.ratingCount ? `${data.ratingCount} ${data.ratingCount === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
        />
        {s.lastPurchaseAt ? <Stat label="Last purchase" value={timeAgo(s.lastPurchaseAt)} /> : null}
      </div>

      <div className="insight-cols">
        <section className="stack" style={{ gap: 12 }}>
          <h2>Ratings</h2>
          {data.ratingCount ? (
            <div className="card bars">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = data.ratingBreakdown[star - 1];
                return (
                  <div key={star} className="bar">
                    <span className="muted small">{star} ★</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(n / tallest) * 100}%` }} />
                    </span>
                    <span className="small num">{n}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="muted">Nobody has rated this vault yet.</p>
          )}

          <h2 style={{ marginTop: 8 }}>Reviews</h2>
          {data.reviews.length === 0 ? <p className="muted">No written reviews yet.</p> : null}
          {data.reviews.map((r) => (
            <div key={r.id} className="review stack" style={{ gap: 4 }}>
              <div className="row between wrap">
                <span>
                  <strong>{r.author?.displayName ?? 'Buyer'}</strong>
                  {r.author ? <span className="muted small"> @{r.author.username}</span> : null}
                </span>
                <span className="muted small">{timeAgo(r.createdAt)}</span>
              </div>
              <Stars value={r.rating} />
              {r.body ? <p>{r.body}</p> : <p className="muted small">Rating only.</p>}
            </div>
          ))}
        </section>

        <section className="stack" style={{ gap: 12 }}>
          <h2>
            Buyers <span className="muted small">{data.purchases.length}</span>
          </h2>
          {data.purchases.length === 0 ? (
            <p className="muted">Nobody has bought this vault yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Buyer</th>
                    <th>When</th>
                    <th className="num">Paid</th>
                    {admin ? (
                      <>
                        <th className="num">Fee</th>
                        <th>Country</th>
                        <th>Money</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {data.purchases.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.buyer ? (
                          <Link href={`/seller/${p.buyer.id}`}>
                            {p.buyer.displayName}
                            <span className="muted small"> @{p.buyer.username}</span>
                          </Link>
                        ) : (
                          <span className="muted">Deleted account</span>
                        )}
                      </td>
                      <td title={p.createdAt}>{formatDate(p.createdAt)}</td>
                      <td className="num">{formatPrice(p.amountCents, currency)}</td>
                      {admin ? (
                        <>
                          <td className="num">{p.amountCents ? formatPrice(p.feeCents, currency) : '—'}</td>
                          <td>{p.buyerCountry ?? '—'}</td>
                          <td className="muted small">{moneyState(p)}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Where a paid sale's money is, for the operator: still reversible by the buyer, past that
 * but not yet paid to us by Dodo, or settled and so payable to the seller.
 */
function moneyState(p: PurchaseRecord): string {
  if (!p.amountCents) return '—';
  if (p.settledAt) return `Settled ${formatDate(p.settledAt)}`;
  if (p.clearsAt && new Date(p.clearsAt).getTime() > Date.now()) return `Clearing until ${formatDate(p.clearsAt)}`;
  return 'Awaiting Dodo settlement';
}

function Stat({ label, value, hint, accent }: { label: string; value: ReactNode; hint?: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' accent' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? (
        <div className="label" style={{ marginTop: 4, fontWeight: 400 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
