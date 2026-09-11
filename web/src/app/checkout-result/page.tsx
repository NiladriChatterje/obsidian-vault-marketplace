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
  const ok = status === 'success';
  const failed = status === 'failed';
  const vaultId = params.get('vault');
  const paymentId = params.get('payment');
  const appScheme = params.get('app');
  const { user, loading } = useAuth();
  const [state, setState] = useState<'checking' | 'ready' | 'pending'>('checking');

  // The webhook can lag a second or two behind the redirect; poll briefly.
  useEffect(() => {
    if (!ok || !vaultId || loading) return;
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
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setState('pending');
    })();
    return () => {
      cancelled = true;
    };
  }, [ok, vaultId, user?.id, loading]);

  return (
    <div className="narrow center stack" style={{ margin: '40px auto', gap: 16 }}>
      <div style={{ fontSize: 56 }}>{ok ? '✓' : '×'}</div>
      <h1>{ok ? 'Payment received' : failed ? 'Payment could not be verified' : 'Checkout cancelled'}</h1>
      {paymentId ? <p className="mono muted">Payment {paymentId}</p> : null}
      <p className="muted">
        {failed
          ? 'The payment could not be confirmed. If money left your account it will be refunded automatically; contact support with the payment id.'
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
          <a href={`${appScheme}://checkout-result?status=${ok ? 'success' : 'cancelled'}${vaultId ? `&vault=${vaultId}` : ''}`} className="btn">
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
