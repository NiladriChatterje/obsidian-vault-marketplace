'use client';

import { useParams } from 'next/navigation';
import { Empty, ErrorBox, Loading, VaultTile } from '@/components/ui';
import { useAsync } from '@shared/hooks/useAsync';
import { api } from '@shared/lib/api';
import { timeAgo } from '@shared/lib/format';

export default function SellerPage() {
  const { id } = useParams<{ id: string }>();
  const profile = useAsync(() => api.getProfile(id), [id]);
  const vaults = useAsync(() => api.getSellerVaults(id), [id]);

  if (profile.loading && !profile.data) return <Loading />;
  if (profile.error || !profile.data) return <ErrorBox message={profile.error ?? 'Seller not found'} onRetry={profile.refresh} />;
  const p = profile.data;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="row" style={{ gap: 16 }}>
        <span className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>
          {p.displayName[0]?.toUpperCase()}
        </span>
        <div>
          <h1>{p.displayName}</h1>
          <p className="muted small">
            @{p.username} · joined {timeAgo(p.createdAt)}
          </p>
        </div>
      </div>
      {p.bio ? <p className="prose">{p.bio}</p> : null}

      <section>
        <h2 style={{ marginBottom: 12 }}>Vaults</h2>
        {vaults.error ? <ErrorBox message={vaults.error} onRetry={vaults.refresh} /> : null}
        {vaults.loading && !vaults.data ? <Loading /> : null}
        {vaults.data && vaults.data.length === 0 ? <Empty title="No published vaults yet" /> : null}
        {vaults.data && vaults.data.length > 0 ? (
          <div className="grid">
            {vaults.data.map((v) => (
              <VaultTile key={v.id} vault={v} />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
