'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Empty, ErrorBox, Loading, Section, VaultTile } from '@/components/ui';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';
import { CATEGORIES, type VaultPage } from '@/types';

export default function ExplorePage() {
  const router = useRouter();
  const { isDemo } = useAuth();
  const [query, setQuery] = useState('');

  const featured = useAsync(() => api.listVaults({ featured: true, limit: 8 }), []);
  const trending = useAsync(() => api.listVaults({ sort: 'popular', limit: 8 }), []);
  const fresh = useAsync(() => api.listVaults({ sort: 'new', limit: 8 }), []);
  const free = useAsync(() => api.listVaults({ freeOnly: true, sort: 'popular', limit: 8 }), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/browse?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <div>
        <h1>Ready-made Obsidian vaults</h1>
        <p className="muted">From people who live in them. Buy once, download the zip or connect it to your AI assistant over MCP.</p>
      </div>
      <div className="search-sticky">
        <form className="search" onSubmit={submit}>
          <span className="muted">⌕</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search vaults, plugins, tags" />
        </form>
      </div>
      <div className="stack" style={{ gap: 16 }}>
        {isDemo ? (
          <div className="notice">
            Demo mode: sample vaults, any email signs in, purchases complete instantly. Set the Supabase keys in the repo <code>.env</code> to go live.
          </div>
        ) : null}
        <div className="chips">
          {CATEGORIES.map((c) => (
            <Link key={c.slug} href={`/browse?category=${c.slug}`} className="chip">
              {c.label}
            </Link>
          ))}
        </div>
      </div>

      <Block title="Featured" href="/browse?sort=popular" state={featured} />
      <Block title="Trending" href="/browse?sort=popular" state={trending} />
      <Block title="Free to start" href="/browse?free=1" state={free} />
      <Block title="New this week" href="/browse?sort=new" state={fresh} />
    </>
  );
}

function Block({ title, href, state }: { title: string; href: string; state: ReturnType<typeof useAsync<VaultPage>> }) {
  return (
    <Section title={title} href={href}>
      {state.error ? <ErrorBox message={state.error} onRetry={state.refresh} /> : null}
      {state.loading && !state.data ? <Loading /> : null}
      {state.data && state.data.items.length === 0 ? <Empty title="Nothing here yet" /> : null}
      {state.data && state.data.items.length > 0 ? (
        <div className="grid">
          {state.data.items.map((v) => (
            <VaultTile key={v.id} vault={v} />
          ))}
        </div>
      ) : null}
    </Section>
  );
}
