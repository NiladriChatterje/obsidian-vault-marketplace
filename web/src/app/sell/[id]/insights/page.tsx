'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { VaultInsightsView } from '@/components/VaultInsights';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** One of the seller's own listings: who bought it, what they paid, and what they said. */
export default function ListingInsightsPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const insights = useAsync(() => (user ? api.getMyVaultInsights(id) : Promise.resolve(null)), [id, user?.id]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to see your sales"
        action={
          <Link href={`/auth?next=${encodeURIComponent(`/sell/${id}/insights`)}`} className="btn">
            Sign in
          </Link>
        }
      />
    );
  }
  if (insights.error) return <ErrorBox message={insights.error} onRetry={insights.refresh} />;
  if (!insights.data) return <Loading />;

  return <VaultInsightsView data={insights.data} audience="seller" back={{ href: '/sell', label: 'Your store' }} />;
}
