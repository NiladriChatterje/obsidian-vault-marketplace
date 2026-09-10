'use client';

/**
 * Target of the password-reset email. Supabase signs the visitor in with a short-lived
 * recovery session when the link is opened, so the form here only has to set a new password
 * on the session that already exists — there is no token to handle by hand.
 *
 * Like /auth/callback, this URL has to be listed under Authentication -> URL Configuration
 * -> Redirect URLs in the Supabase dashboard.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Field, Loading } from '@/components/ui';
import { MIN_PASSWORD_LENGTH } from '@/lib/config';
import { errorMessage } from '@/lib/web';
import { useAuth } from '@/store/auth';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { user, loading, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The recovery session is established asynchronously as the client parses the link.
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(password);
      setDone(true);
      setTimeout(() => router.replace('/'), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading || (!user && !waited)) return <Loading label="Opening your reset link…" />;

  if (!user) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <div className="card stack">
          <h1>This reset link is no longer valid</h1>
          <p className="help">Reset links expire after an hour and can only be used once. Ask for a new one and try again.</p>
          <Link className="btn block" href="/auth">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="card stack" style={{ gap: 16 }}>
        <h1>Choose a new password</h1>
        <p className="help">Signed in as {user.email}. The new password replaces the old one everywhere.</p>
        <form className="stack" onSubmit={submit}>
          <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </Field>
          <Field label="Repeat new password">
            <input
              className="input"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          {error ? <div className="error">{error}</div> : null}
          {done ? <div className="notice">Password updated. Taking you back to the marketplace…</div> : null}
          <button className="btn block" disabled={busy || done}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      </div>
    </div>
  );
}
