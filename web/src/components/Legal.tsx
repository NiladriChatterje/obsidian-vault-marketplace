import type { ReactNode } from 'react';
import { BUSINESS } from '@/lib/legal';

/** Shared frame for the policy pages: readable width, title and last-updated line. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="legal">
      <h1>{title}</h1>
      <p className="muted small">
        Last updated {BUSINESS.lastUpdated} · {BUSINESS.tradingName}, operated by {BUSINESS.legalName}
      </p>
      {children}
    </article>
  );
}
