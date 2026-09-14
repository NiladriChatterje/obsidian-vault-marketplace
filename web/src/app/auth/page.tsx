'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { MIN_PASSWORD_LENGTH } from '@/lib/config';
import { landingFor } from '@/lib/onboarding';
import { errorMessage } from '@/lib/web';
import { useAuth } from '@/store/auth';
import type { AccountRole } from '@/types';

const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export default function AuthPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AuthForm />
    </Suspense>
  );
}

type Mode = 'in' | 'up' | 'forgot';

const ROLE_HELP: Record<AccountRole, string> = {
  buyer: 'Browse, buy and download vaults. You can start selling later from the Sell tab.',
  seller: 'You will be asked where to send your earnings next. Free vaults can be listed before that; paid ones cannot.',
};

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const { signIn, signUp, isUsernameAvailable, sendPasswordReset, resendConfirmation, refreshProfile, setMode: setSide, isDemo } = useAuth();

  const [mode, setMode] = useState<Mode>('in');
  // Someone sent here from the Sell tab has already said what they are here for.
  const [role, setRole] = useState<AccountRole>(next.startsWith('/sell') ? 'seller' : 'buyer');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Sign-in fails this way when the address was never confirmed, so offer the mail again.
  const [unconfirmed, setUnconfirmed] = useState(false);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
    setUnconfirmed(false);
  };

  /**
   * Signed in, with a session in hand. Choosing to sell turns selling on for the profile,
   * which the Sell tab would otherwise ask for with a second click; choosing to buy changes
   * nothing, so a seller who signs in as a buyer stays a seller.
   */
  const arrive = async () => {
    // An administrator's visit is the dashboard, whatever they picked above.
    if (await api.isAdmin()) return router.replace('/admin');
    if (role === 'seller') {
      await api.updateProfile({ isSeller: true });
      await refreshProfile();
    }
    setSide(role);
    router.replace(await landingFor(role, next));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    setBusy(true);
    setError(null);
    setInfo(null);
    setUnconfirmed(false);
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(address);
        // Deliberately the same answer whether or not the address has an account.
        setInfo(`If an account exists for ${address}, a reset link is on its way. The link opens this site and expires in an hour.`);
      } else if (mode === 'in') {
        await signIn(address, password);
        await arrive();
      } else {
        if (!USERNAME_RE.test(username)) throw new Error('Username: 3–24 lowercase letters, digits, dots or underscores.');
        if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        if (!isDemo && !(await isUsernameAvailable(username))) throw new Error('That username is taken. Pick another.');
        const { needsEmailConfirm } = await signUp(address, password, username, role);
        if (needsEmailConfirm) {
          go('in');
          setInfo(
            role === 'seller'
              ? `Almost there — open the confirmation link we sent to ${address}. It brings you back here to set up how you get paid.`
              : `Almost there — open the confirmation link we sent to ${address}, then sign in.`
          );
        } else {
          await arrive();
        }
      }
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setUnconfirmed(/confirm your email/i.test(message));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      await resendConfirmation(email.trim().toLowerCase());
      setUnconfirmed(false);
      setInfo('Confirmation email sent again. It can take a minute to arrive.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'forgot' ? 'Reset your password' : mode === 'in' ? 'Sign in' : 'Create account';

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="card stack" style={{ gap: 16 }}>
        <div className="tabs">
          <button className={mode === 'in' || mode === 'forgot' ? 'active' : ''} onClick={() => go('in')} type="button">
            Sign in
          </button>
          <button className={mode === 'up' ? 'active' : ''} onClick={() => go('up')} type="button">
            Create account
          </button>
        </div>
        {isDemo ? <div className="notice">Demo mode: any email and password signs you in.</div> : null}
        <form className="stack" onSubmit={submit}>
          {mode === 'forgot' ? (
            <p className="help">Enter the email you signed up with and we will send a link to set a new password.</p>
          ) : (
            <div className="field">
              <span className="label">I am here to</span>
              <div className="segmented" role="radiogroup" aria-label="What you want to do">
                <button type="button" role="radio" aria-checked={role === 'buyer'} className={role === 'buyer' ? 'active' : ''} onClick={() => setRole('buyer')}>
                  Buy vaults
                </button>
                <button type="button" role="radio" aria-checked={role === 'seller'} className={role === 'seller' ? 'active' : ''} onClick={() => setRole('seller')}>
                  Sell vaults
                </button>
              </div>
              <span className="help">{ROLE_HELP[role]}</span>
            </div>
          )}
          {mode === 'up' ? (
            <Field label="Username" hint="3–24 characters: lowercase letters, digits, dots or underscores. This is your public seller name.">
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().trim())}
                placeholder="nova.notes"
                autoComplete="username"
                required
              />
            </Field>
          ) : null}
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </Field>
          {mode === 'forgot' ? null : (
            <Field label="Password" hint={mode === 'up' && !isDemo ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined}>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                minLength={mode === 'up' && !isDemo ? MIN_PASSWORD_LENGTH : undefined}
                required
              />
            </Field>
          )}
          {error ? <div className="error">{error}</div> : null}
          {unconfirmed ? (
            <button className="btn ghost block" type="button" onClick={resend} disabled={busy}>
              Send the confirmation email again
            </button>
          ) : null}
          {info ? <div className="notice">{info}</div> : null}
          <button className="btn block" disabled={busy}>
            {busy ? 'Please wait…' : title}
          </button>
          {mode === 'in' ? (
            <button className="btn ghost block" type="button" onClick={() => go('forgot')}>
              Forgot your password?
            </button>
          ) : null}
          {mode === 'forgot' ? (
            <button className="btn ghost block" type="button" onClick={() => go('in')}>
              Back to sign in
            </button>
          ) : null}
          {mode === 'up' ? (
            <p className="help center">
              By creating an account you accept our <Link href="/terms">Terms</Link>, <Link href="/privacy">Privacy Policy</Link> and{' '}
              <Link href="/refunds">Refund Policy</Link>.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
