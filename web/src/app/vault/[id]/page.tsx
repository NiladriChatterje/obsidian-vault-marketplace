'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Cover, ErrorBox, Loading, Price, Stars } from '@/components/ui';
import { VaultContents } from '@/components/VaultContents';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { formatBytes, formatCount, timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { categoryLabel } from '@/types';

export default function VaultPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isDemo } = useAuth();

  const vault = useAsync(() => api.getVault(id), [id]);
  const reviews = useAsync(() => api.getReviews(id), [id]);
  const access = useAsync(() => (user ? api.hasAccess(id) : Promise.resolve(false)), [id, user?.id]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const v = vault.data;
  const owned = !!access.data;
  const isMine = !!user && v?.sellerId === user.id;

  const requireAuth = (): boolean => {
    if (user) return true;
    router.push(`/auth?next=${encodeURIComponent(`/vault/${id}`)}`);
    return false;
  };

  const onGet = async () => {
    if (!v || !requireAuth()) return;
    setBusy(true);
    setError(null);
    try {
      if (v.priceCents === 0) {
        await api.claimFreeVault(v.id);
      } else {
        const { url } = await api.createCheckout(v.id);
        if (/^https?:/.test(url)) {
          // The payment server's checkout page brings the buyer back to /checkout-result.
          window.location.assign(url);
          return;
        }
      }
      await Promise.all([access.refresh(), vault.refresh()]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async () => {
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      const url = await api.getDownloadUrl(v.id);
      if (isDemo) window.open(url, '_blank', 'noopener');
      else window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e, 'Download failed.'));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!v || !reviewBody.trim()) return;
    setSubmitting(true);
    try {
      await api.addReview(v.id, rating, reviewBody.trim());
      setReviewBody('');
      await Promise.all([reviews.refresh(), vault.refresh()]);
    } catch (err) {
      setError(errorMessage(err, 'Could not post review.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (vault.loading && !v) return <Loading />;
  if (vault.error || !v) return <ErrorBox message={vault.error ?? 'Vault not found'} onRetry={vault.refresh} />;

  const myReview = user ? reviews.data?.find((r) => r.userId === user.id) : undefined;

  return (
    <div className="detail">
      <div className="stack" style={{ gap: 20 }}>
        <Cover vault={v} hero />
        {/* Named so one column can place the buy box directly after it. */}
        <div className="vault-head">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <h1>{v.title}</h1>
            <Price cents={v.priceCents} currency={v.currency} large />
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            {v.tagline}
          </p>
        </div>

        <div className="row wrap muted small" style={{ gap: 16 }}>
          {v.seller ? (
            <Link href={`/seller/${v.seller.id}`} className="row">
              <span className="avatar" style={{ width: 24, height: 24, fontSize: 11 }}>
                {v.seller.displayName[0]?.toUpperCase()}
              </span>
              <span style={{ color: 'var(--text)' }}>{v.seller.displayName}</span>
            </Link>
          ) : null}
          {v.ratingCount > 0 ? <Stars value={v.ratingAvg} count={v.ratingCount} /> : <span>No reviews yet</span>}
          <span>{formatCount(v.downloads)} downloads</span>
          <span>{categoryLabel(v.category)}</span>
        </div>

        <div className="stats">
          <Stat label="Notes" value={v.noteCount ? formatCount(v.noteCount) : '—'} />
          <Stat label="Size" value={formatBytes(v.sizeBytes)} />
          <Stat label="Version" value={v.version} />
          <Stat label="Updated" value={timeAgo(v.updatedAt)} />
        </div>

        <section>
          <h2 style={{ marginBottom: 8 }}>About this vault</h2>
          <p className="prose">{v.description}</p>
        </section>

        <VaultContents vaultId={v.id} owned={owned || isMine} />

        {v.plugins.length ? (
          <section>
            <h3 style={{ marginBottom: 8 }}>Plugins used</h3>
            <div className="chips">
              {v.plugins.map((p) => (
                <span key={p} className="tag">
                  {p}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {v.tags.length ? (
          <div className="chips">
            {v.tags.map((t) => (
              <Link key={t} href={`/browse?q=${encodeURIComponent(t)}`} className="tag">
                #{t}
              </Link>
            ))}
          </div>
        ) : null}

        <section className="stack">
          <h2>Reviews</h2>
          {owned && !isMine ? (
            <form className="card stack" onSubmit={onSubmitReview}>
              <div className="row">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" className="btn ghost small" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                    <span style={{ fontSize: 18, color: n <= rating ? 'var(--text)' : 'var(--faint)' }}>★</span>
                  </button>
                ))}
              </div>
              <textarea
                className="textarea"
                style={{ minHeight: 80 }}
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                placeholder={myReview ? 'Update your review' : 'What did this vault change for you?'}
              />
              <div>
                <button className="btn" disabled={submitting || !reviewBody.trim()}>
                  {submitting ? 'Posting…' : myReview ? 'Update review' : 'Post review'}
                </button>
              </div>
            </form>
          ) : null}
          {reviews.loading && !reviews.data ? <Loading /> : null}
          {reviews.data && reviews.data.length === 0 ? <p className="muted">Be the first to review after you try it.</p> : null}
          {reviews.data?.map((r) => (
            <div key={r.id} className="review stack" style={{ gap: 4 }}>
              <div className="row between">
                <strong>{r.author?.displayName ?? 'Buyer'}</strong>
                <span className="muted small">{timeAgo(r.createdAt)}</span>
              </div>
              <Stars value={r.rating} />
              <p>{r.body}</p>
            </div>
          ))}
        </section>
      </div>

      <aside className="card stack sticky">
        <Price cents={v.priceCents} currency={v.currency} large />
        {error ? <div className="error">{error}</div> : null}
        {isMine ? (
          <>
            <p className="muted small">This is your listing.</p>
            <Link href={`/sell/${v.id}`} className="btn secondary block">
              Edit listing
            </Link>
          </>
        ) : owned ? (
          <>
            {v.pluginOnly ? (
              <Link href={`/connect?vault=${v.id}#obsidian-plugin`} className="btn block">
                Install in Obsidian
              </Link>
            ) : (
              <button className="btn block" onClick={onDownload} disabled={busy}>
                {busy ? 'Preparing…' : 'Download .zip'}
              </button>
            )}
            <Link href={`/connect?vault=${v.id}`} className="btn secondary block">
              Connect over MCP
            </Link>
            <p className="help">
              {v.pluginOnly
                ? 'This vault has no .zip: the Vault Market plugin writes it into your Obsidian vault and keeps it up to date without touching notes you have edited. Your AI assistant can still read it over MCP.'
                : 'Unzip into your Obsidian vaults folder, or point your AI assistant at the MCP endpoint to read these notes.'}
            </p>
          </>
        ) : (
          <>
            <button className="btn block" onClick={onGet} disabled={busy || access.loading}>
              {busy ? 'Working…' : v.priceCents === 0 ? 'Get for free' : `Buy for ${new Intl.NumberFormat(undefined, { style: 'currency', currency: v.currency }).format(v.priceCents / 100)}`}
            </button>
            <p className="help">
              {v.priceCents === 0 ? (
                'Free vaults are added to your library instantly.'
              ) : (
                <>
                  Secure checkout in your own currency, tax included. Personal, non-transferable license. Download and MCP access forever.{' '}
                  {/* Said before paying, not afterwards in a policy page. The whole vault is
                      delivered on payment, so there is nothing to give back. */}
                  <strong>All sales are final</strong> and there are no refunds, so read the preview notes first.{' '}
                  <Link href="/refunds">Why</Link>.
                </>
              )}
            </p>
          </>
        )}
        {isMine ? null : owned ? null : (
          <p className="help">
            Includes: zip download · MCP access · free updates from {v.seller?.displayName ?? 'the seller'}
          </p>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 18 }}>
        {value}
      </div>
    </div>
  );
}
