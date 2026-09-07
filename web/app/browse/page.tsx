'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Empty, ErrorBox, Loading, VaultTile } from '@/components/ui';
import { useAsync } from '@shared/hooks/useAsync';
import { api } from '@shared/lib/api';
import { CATEGORIES, categoryLabel, type CategorySlug, type SortMode } from '@shared/types';

export default function BrowsePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Browse />
    </Suspense>
  );
}

function Browse() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get('q') ?? '';
  const category = (params.get('category') as CategorySlug | null) ?? undefined;
  const sort = (params.get('sort') as SortMode | null) ?? 'popular';
  const freeOnly = params.get('free') === '1';
  const [query, setQuery] = useState(q);

  const results = useAsync(() => api.listVaults({ search: q || undefined, category, sort, freeOnly }), [q, category, sort, freeOnly]);

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    router.push(`/browse?${next.toString()}`);
  };

  const title = q ? `Results for “${q}”` : category ? categoryLabel(category) : freeOnly ? 'Free vaults' : 'Browse';

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1>{title}</h1>
      <form
        className="search"
        onSubmit={(e) => {
          e.preventDefault();
          setParam({ q: query.trim() });
        }}
      >
        <span className="muted">⌕</span>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vaults, plugins, tags" />
      </form>

      <div className="chips">
        <button className={`chip${!category ? ' selected' : ''}`} onClick={() => setParam({ category: null })}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.slug} className={`chip${category === c.slug ? ' selected' : ''}`} onClick={() => setParam({ category: c.slug })}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="row between wrap">
        <div className="tabs">
          {(['popular', 'new', 'top'] as SortMode[]).map((s) => (
            <button key={s} className={sort === s ? 'active' : ''} onClick={() => setParam({ sort: s })}>
              {{ popular: 'Popular', new: 'Newest', top: 'Top rated' }[s]}
            </button>
          ))}
        </div>
        <label className="switch small muted">
          <input type="checkbox" checked={freeOnly} onChange={(e) => setParam({ free: e.target.checked ? '1' : null })} /> Free only
        </label>
      </div>

      {results.error ? <ErrorBox message={results.error} onRetry={results.refresh} /> : null}
      {results.loading && !results.data ? <Loading /> : null}
      {results.data && results.data.length === 0 ? (
        <Empty
          title="No vaults match"
          message="Try another search or category."
          action={
            <Link href="/browse" className="btn secondary">
              Clear filters
            </Link>
          }
        />
      ) : null}
      {results.data && results.data.length > 0 ? (
        <div className="grid">
          {results.data.map((v) => (
            <VaultTile key={v.id} vault={v} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
