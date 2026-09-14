'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Empty, ErrorBox, Loading } from '@/components/ui';
import { VaultInsightsView } from '@/components/VaultInsights';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** One vault as the operator sees it: every buyer, every review, and where the money stands. */
export default function AdminVaultPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading, isAdmin } = useAuth();
  const insights = useAsync(() => (user && isAdmin ? api.getAdminVault(id) : Promise.resolve(null)), [id, user?.id, isAdmin]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="Sign in to open the dashboard"
        action={
          <Link href={`/auth?next=${encodeURIComponent(`/admin/vaults/${id}`)}`} className="btn">
            Sign in
          </Link>
        }
      />
    );
  }
  if (!isAdmin) return <Empty title="Not an administrator" message="This page is for the people named in ADMIN_USER_IDS on the server." />;
  if (insights.error) return <ErrorBox message={insights.error} onRetry={insights.refresh} />;
  if (!insights.data) return <Loading />;

  return <VaultInsightsView data={insights.data} audience="admin" back={{ href: '/admin', label: 'Dashboard' }} />;
}
