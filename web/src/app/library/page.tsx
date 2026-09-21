'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Empty, ErrorBox, Loading, VaultRow } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { formatPrice, timeAgo } from '@/lib/format';
import { useAuth } from '@/store/auth';

export default function LibraryPage() {
  const { user, loading, isDemo } = useAuth();
  const library = useAsync(() => (user ? api.getLibrary() : Promise.resolve([])), [user?.id]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (vaultId: string) => {
    setBusyId(vaultId);
    setError(null);
    try {
      const url = await api.getDownloadUrl(vaultId);
      if (isDemo) window.open(url, '_blank', 'noopener');
      else window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e, 'Download failed.'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to see your library"
        message="Everything you buy or grab for free lives here, on every device."
        action={
          <Link href="/auth?next=/library" className="btn">
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between wrap">
        <h1>Library</h1>
        <Link href="/connect" className="btn secondary small">
          Connect over MCP
        </Link>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {library.error ? <ErrorBox message={library.error} onRetry={library.refresh} /> : null}
      {library.loading && !library.data ? <Loading /> : null}
      {library.data && library.data.length === 0 ? (
        <Empty
          title="Nothing here yet"
          message="Grab a free vault to see how downloads and MCP access work."
          action={
            <Link href="/browse?free=1" className="btn">
              Browse free vaults
            </Link>
          }
        />
      ) : null}
      <div className="stack">
        {library.data?.map((p) =>
          p.vault ? (
            <VaultRow
              key={p.id}
              className="library-row"
              vault={p.vault}
              href={`/vault/${p.vault.id}`}
              subtitle={
                <>
                  {p.vault.seller?.displayName ? <>{p.vault.seller.displayName} · </> : null}
                  Added {timeAgo(p.createdAt)} · {formatPrice(p.amountCents, p.vault.currency)}
                </>
              }
              right={
                <div className="row library-actions">
                  {p.vault.pluginOnly ? null : (
                    <button className="btn small secondary" disabled={busyId === p.vaultId} onClick={() => download(p.vaultId)}>
                      {busyId === p.vaultId ? 'Preparing…' : 'Download'}
                    </button>
                  )}
                  <Link href={`/connect?vault=${p.vaultId}`} className="btn small secondary">
                    MCP
                  </Link>
                </div>
              }
            />
          ) : null
        )}
      </div>
    </div>
  );
}
