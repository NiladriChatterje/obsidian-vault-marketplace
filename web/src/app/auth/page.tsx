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

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const { startSignIn, verifySignIn, signUp, isUsernameAvailable, sendPasswordReset, resendConfirmation, refreshProfile, setMode: rememberSide, isDemo } = useAuth();

  const [mode, setMode] = useState<Mode>('in');
  // Nobody is asked which side they are here for: everyone arrives buying and crosses over on
  // the account page. The one hint taken is the door they came through, so someone sent here
  // from the Sell tab is set up to sell straight away.
  const role: AccountRole = next.startsWith('/sell') ? 'seller' : 'buyer';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Signing in is two steps: the password earns a code, the code earns a session. Holding a
  // challenge id is what says the first step is done — there is no session until the second.
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
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
    setChallengeId(null);
    setCode('');
  };

  const codeSentNotice = (address: string) => `We emailed a six-digit code to ${address}. Enter it below — it expires in 5 minutes.`;

  /**
   * Signed in, with a session in hand. Coming through the Sell tab turns selling on for the
   * profile, which that tab would otherwise ask for with a second click; any other door
   * changes nothing, so a seller who signs in from the front page stays a seller and simply
   * starts out buying. An administrator sent here by the dashboard goes back to it; the
   * server, not this page, decides whether they may.
   */
  const arrive = async () => {
    if (next.startsWith('/admin') && (await api.isAdmin())) {
      rememberSide('admin');
      router.replace(next);
      return;
    }
    if (role === 'seller') {
      await api.updateProfile({ isSeller: true });
      await refreshProfile();
    }
    rememberSide(role);
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
      } else if (mode === 'in' && !challengeId) {
        // The password buys a code, not a session: nothing is signed in until the code is back.
        const started = await startSignIn(address, password);
        setChallengeId(started.challengeId);
        setPassword('');
        setInfo(codeSentNotice(address));
      } else if (mode === 'in' && challengeId) {
        await verifySignIn(challengeId, code.trim());
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

  const resendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      // A new code means a new challenge, so the password is asked for again rather than
      // being held in the page while the first code sits unused in an inbox.
      setChallengeId(null);
      setCode('');
      setInfo('Enter your password again and we will send a new code.');
    } catch (err) {
      setError(errorMessage(err));
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

  const title = mode === 'forgot' ? 'Reset your password' : mode === 'up' ? 'Create account' : challengeId ? 'Sign in' : 'Continue';

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
        {isDemo ? <div className="notice">Demo mode: any email and password signs you in, and any six digits work as the code.</div> : null}
        <form className="stack" onSubmit={submit}>
          {mode === 'forgot' ? (
            <p className="help">Enter the email you signed up with and we will send a link to set a new password.</p>
          ) : mode === 'in' && !challengeId ? (
            <p className="help">After your password we email you a six-digit code. Both are needed, so a stolen password is not enough on its own.</p>
          ) : role === 'seller' ? (
            <p className="help">You will be asked where to send your earnings next. Free vaults can be listed before that; paid ones cannot.</p>
          ) : null}
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
              readOnly={mode === 'in' && !!challengeId}
              required
            />
          </Field>
          {mode === 'up' || (mode === 'in' && !challengeId) ? (
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
          ) : null}
          {mode === 'in' && challengeId ? (
            <Field label="Six-digit code" hint="Check your inbox, and the spam folder if it is not there.">
              <input
                className="input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                minLength={6}
                autoFocus
                required
              />
            </Field>
          ) : null}
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
          {mode === 'in' && challengeId ? (
            <>
              <button className="btn ghost block" type="button" onClick={resendCode} disabled={busy}>
                Send another code
              </button>
              <button className="btn ghost block" type="button" onClick={() => go('in')}>
                Use a different email
              </button>
            </>
          ) : null}
          {mode === 'in' && !challengeId ? (
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
