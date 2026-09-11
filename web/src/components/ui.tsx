'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { formatCount, formatPrice } from '@/lib/format';
import type { Vault, VaultStatus } from '@/types';

export function monogram(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || 'V';
}

export function Cover({ vault, hero }: { vault: Pick<Vault, 'title' | 'coverUrl'>; hero?: boolean }) {
  return (
    <div className={`cover${hero ? ' hero' : ''}`}>
      {vault.coverUrl ? <img src={vault.coverUrl} alt="" /> : <span className="monogram">{monogram(vault.title)}</span>}
    </div>
  );
}

export function Price({ cents, currency, large }: { cents: number; currency?: string; large?: boolean }) {
  return <span className={`price${large ? ' large' : ''}`}>{formatPrice(cents, currency)}</span>;
}

export function Stars({ value, count }: { value: number; count?: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" title={`${value.toFixed(1)} / 5`}>
      {'★'.repeat(full)}
      <span className="faint">{'★'.repeat(5 - full)}</span>
      {count !== undefined ? <span className="muted small"> {formatCount(count)}</span> : null}
    </span>
  );
}

export function VaultTile({ vault }: { vault: Vault }) {
  return (
    <Link href={`/vault/${vault.id}`} className="tile">
      <Cover vault={vault} />
      <div>
        <div className="tile-title clamp2">{vault.title}</div>
        <div className="muted small truncate">{vault.seller?.displayName ?? ''}</div>
      </div>
      <div className="tile-meta">
        {vault.ratingCount > 0 ? <Stars value={vault.ratingAvg} count={vault.ratingCount} /> : <span>{formatCount(vault.downloads)} downloads</span>}
        <Price cents={vault.priceCents} currency={vault.currency} />
      </div>
    </Link>
  );
}

export function VaultRow({ vault, href, right }: { vault: Vault; href?: string; right?: ReactNode }) {
  const body = (
    <>
      <Cover vault={vault} />
      <div className="grow">
        <div className="tile-title truncate">{vault.title}</div>
        <div className="muted small clamp2">{vault.tagline}</div>
      </div>
      {right ?? <Price cents={vault.priceCents} currency={vault.currency} />}
    </>
  );
  return href ? (
    <Link href={href} className="vault-row">
      {body}
    </Link>
  ) : (
    <div className="vault-row">{body}</div>
  );
}

export function StatusPill({ status }: { status: VaultStatus }) {
  const label = { published: 'Live', draft: 'Draft', unlisted: 'Unlisted' }[status];
  return <span className={`pill${status === 'published' ? ' live' : ''}`}>{label}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error row between">
      <span>{message}</span>
      {onRetry ? (
        <button className="btn small secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}

export function Section({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-title">
        <h2>{title}</h2>
        {href ? <Link href={href}>See all</Link> : null}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="help">{hint}</span> : null}
    </label>
  );
}

/**
 * A refusal the seller must see even when the page's error banner is scrolled out of
 * view, which is what happens when a zip is rejected from a button near the top of a
 * long form. Dismisses itself; `onClose` clears the state that raised it.
 */
export function Toast({ title, message, onClose, duration = 8000 }: { title: string; message?: string; onClose: () => void; duration?: number }) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [onClose, duration]);

  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      <div className="toast">
        <div className="toast-body">
          <div className="toast-title">{title}</div>
          {message ? <div className="toast-message">{message}</div> : null}
        </div>
        <button className="toast-close" onClick={onClose} aria-label="Dismiss">
          ×
        </button>
      </div>
    </div>
  );
}
