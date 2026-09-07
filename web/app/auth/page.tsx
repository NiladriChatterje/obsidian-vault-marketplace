'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { useAuth } from '@shared/store/auth';

export default function AuthPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuthForm />
    </Suspense>
  );
}

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const { signIn, signUp, isDemo } = useAuth();

  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password);
        router.replace(next);
      } else {
        if (!/^[a-z0-9_.]{3,24}$/.test(username)) throw new Error('Username: 3–24 lowercase letters, digits, dots or underscores.');
        if (password.length < 6) throw new Error('Password must be at least 6 characters.');
        const { needsEmailConfirm } = await signUp(email.trim(), password, username);
        if (needsEmailConfirm) setInfo('Check your inbox to confirm your email, then sign in.');
        else router.replace(next);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="card stack" style={{ gap: 16 }}>
        <div className="tabs">
          <button className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')} type="button">
            Sign in
          </button>
          <button className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')} type="button">
            Create account
          </button>
        </div>
        {isDemo ? <div className="notice">Demo mode: any email and password signs you in.</div> : null}
        <form className="stack" onSubmit={submit}>
          {mode === 'up' ? (
            <Field label="Username">
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="nova.notes" autoComplete="username" />
            </Field>
          ) : null}
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              required
            />
          </Field>
          {error ? <div className="error">{error}</div> : null}
          {info ? <div className="notice">{info}</div> : null}
          <button className="btn block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
