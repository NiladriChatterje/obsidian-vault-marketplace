'use client';

/**
 * Where Supabase sends people after they click the confirmation link in a sign-up email.
 *
 * The browser client is created with `detectSessionInUrl`, so it exchanges the `code` in the
 * query string for a session by itself as soon as it loads; this page only waits for that to
 * land and then gets out of the way. Supabase puts failures (an expired or already-used link)
 * in `error_description`, which is shown rather than left as a blank screen.
 *
 * The URL must be listed under Authentication -> URL Configuration -> Redirect URLs in the
 * Supabase dashboard, or the link falls back to the Site URL and never reaches this page.
 */

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { landingFor } from '@/lib/onboarding';
import { useAuth } from '@/store/auth';

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<Loading label="Confirming…" />}>
      <Callback />
    </Suspense>
  );
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const { setMode } = useAuth();
  const next = params.get('next') ?? '/';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const failure = params.get('error_description') ?? params.get('error');
    if (failure) {
      setError(failure);
      return;
    }
    let active = true;
    let tries = 0;
    const tick = async () => {
      if (!active) return;
      const user = await api.getCurrentUser();
      if (user) {
        // Someone who signed up to sell is sent to say where to pay them; the profile
        // trigger already made them a seller from the role in their sign-up metadata.
        const profile = await api.getProfile(user.id).catch(() => null);
        const role = profile?.isSeller ? 'seller' : 'buyer';
        setMode(role);
        router.replace(await landingFor(role, next));
        return;
      }
      // The exchange is a network round trip that starts when the client module loads.
      if (++tries > 20) {
        setError('That confirmation link has expired or was already used. Sign in, or request a new link.');
        return;
      }
      timer = setTimeout(tick, 250);
    };
    let timer = setTimeout(tick, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [params, next, router, setMode]);

  if (error) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <div className="card stack">
          <h1>Could not confirm your email</h1>
          <div className="error">{error}</div>
          <Link className="btn block" href="/auth">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }
  return <Loading label="Confirming your email…" />;
}
