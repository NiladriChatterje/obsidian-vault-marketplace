'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

/** Landing page the buyer returns to after checkout. It only reports the outcome: the
 * purchase itself is granted by the provider's webhook, so this page never grants access. */
export default function CheckoutResultPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CheckoutResult />
    </Suspense>
  );
}

function CheckoutResult() {
  const params = useSearchParams();
  const status = params.get('status');
  const vaultId = params.get('vault');
  const paymentId = params.get('payment');
  const appScheme = params.get('app');
  const { user, loading } = useAuth();
  const [state, setState] = useState<'checking' | 'ready' | 'pending' | 'failed'>('checking');
  // The provider brings every outcome back to this same url, so a declined payment
  // arrives looking like a successful one. Only the order row tells the two apart.
  const paid = status === 'success';
  const failed = status === 'failed' || state === 'failed';
  const ok = paid && !failed;

  // The webhook can lag a second or two behind the redirect; poll briefly.
  useEffect(() => {
    if (!paid || !vaultId || loading) return;
    if (!user) {
      setState('pending');
      return;
    }
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        if (await api.hasAccess(vaultId).catch(() => false)) {
          if (!cancelled) setState('ready');
          return;
        }
        if ((await api.lastOrderStatus(vaultId).catch(() => null)) === 'failed') {
          if (!cancelled) setState('failed');
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setState('pending');
    })();
    return () => {
      cancelled = true;
    };
  }, [paid, vaultId, user?.id, loading]);

  return (
    <div className="narrow center stack" style={{ margin: '40px auto', gap: 16 }}>
      <div style={{ fontSize: 56 }}>{ok ? '✓' : '×'}</div>
      <h1>{ok ? 'Payment received' : failed ? 'Payment did not go through' : 'Checkout cancelled'}</h1>
      {paymentId ? <p className="mono muted">Payment {paymentId}</p> : null}
      <p className="muted">
        {failed
          ? 'The payment did not complete, so no vault was added to your library. If money did leave your account, contact support and we will sort it out.'
          : !ok
          ? 'No charge was made. You can come back to the vault any time.'
          : state === 'checking'
            ? 'Adding the vault to your library. This usually takes a second or two…'
            : state === 'ready'
              ? 'Your vault is ready. Download it or connect it over MCP.'
              : 'Your purchase is confirmed and will appear in your library shortly. Sign in on this device if you have not already.'}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {appScheme ? (
          <a href={`${appScheme}://checkout-result?status=${ok ? 'success' : failed ? 'failed' : 'cancelled'}${vaultId ? `&vault=${vaultId}` : ''}`} className="btn">
            Return to the app
          </a>
        ) : null}
        {vaultId ? (
          <Link href={`/vault/${vaultId}`} className="btn">
            {ok ? 'Open vault' : 'Back to vault'}
          </Link>
        ) : null}
        <Link href="/library" className="btn secondary">
          Go to library
        </Link>
      </div>
    </div>
  );
}
