'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, Field, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { api } from '@/lib/api';
import type { Mode } from '@/lib/mode';
import { landingFor } from '@/lib/onboarding';
import { useAuth } from '@/store/auth';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, signOut, refreshProfile, mode, setMode, isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setBio(profile?.bio ?? '');
  }, [profile?.id, profile?.displayName, profile?.bio]);

  if (loading) return <Loading />;
  if (!user) {
    return (
      <Empty
        title="You are signed out"
        action={
          <Link href="/auth?next=/profile" className="btn">
            Sign in
          </Link>
        }
      />
    );
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.updateProfile({ displayName: displayName.trim() || undefined, bio: bio.trim() });
      await refreshProfile();
      setMsg('Saved.');
    } catch (err) {
      setMsg(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Cross to another side of the site. Selling is turned on for the profile the first time,
   * and a seller with nowhere to be paid yet is taken to say where, as at sign-in. The
   * dashboard is offered only while the server names this account in ADMIN_USER_IDS.
   */
  const switchTo = async (side: Mode) => {
    setSwitching(true);
    setSwitchError(null);
    try {
      if (side === 'admin') {
        setMode('admin');
        router.push('/admin');
        return;
      }
      if (side === 'seller' && !profile?.isSeller) {
        await api.updateProfile({ isSeller: true });
        await refreshProfile();
      }
      setMode(side);
      router.push(await landingFor(side, side === 'seller' ? '/sell' : '/'));
    } catch (err) {
      setSwitchError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="narrow stack" style={{ margin: '0 auto', gap: 16 }}>
      <h1>Account</h1>
      <div className="card stack">
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
            {(profile?.displayName ?? user.email)[0]?.toUpperCase()}
          </span>
          <div>
            <strong>{profile?.displayName ?? user.email}</strong>
            <div className="muted small">
              {user.email}
              {profile ? ` · @${profile.username}` : ''}
            </div>
          </div>
        </div>
        {profile?.id && mode !== 'admin' ? (
          <Link href={`/seller/${profile.id}`} className="muted small">
            View public profile →
          </Link>
        ) : null}
      </div>

      {/* One account can buy and sell, and the administrator's can also run the place; the site shows one side at a time. This is where to cross over. */}
      <div className="card stack">
        <div>
          <strong>{mode === 'admin' ? 'You are running the dashboard' : mode === 'seller' ? 'You are selling' : 'You are buying'}</strong>
          <p className="muted small" style={{ marginTop: 4 }}>
            {mode === 'admin'
              ? 'Your one tab is the dashboard: every purchase across the marketplace and how each vault is doing. Switch sides to buy or sell as anyone else does.'
              : mode === 'seller'
                ? 'Your tabs are your store, new listings and payouts. Switch to buying to browse and use your library.'
                : profile?.isSeller
                  ? 'Your tabs are Explore, Library and MCP. Switch to selling to see your store, listings and payouts.'
                  : 'Your tabs are Explore, Library and MCP. Start selling to list your own vaults; you will be asked where to send your earnings.'}
          </p>
        </div>
        {switchError ? <div className="error">{switchError}</div> : null}
        {/* Every side this account can be on, the current one lit. Picking another crosses over. */}
        <div className="segmented" role="radiogroup" aria-label="Which side of the site you are on">
          <button type="button" role="radio" aria-checked={mode === 'buyer'} className={mode === 'buyer' ? 'active' : ''} onClick={() => switchTo('buyer')} disabled={switching || mode === 'buyer'}>
            Buying
          </button>
          <button type="button" role="radio" aria-checked={mode === 'seller'} className={mode === 'seller' ? 'active' : ''} onClick={() => switchTo('seller')} disabled={switching || mode === 'seller'}>
            {profile?.isSeller || mode === 'seller' ? 'Selling' : 'Start selling'}
          </button>
          {isAdmin ? (
            <button type="button" role="radio" aria-checked={mode === 'admin'} className={mode === 'admin' ? 'active' : ''} onClick={() => switchTo('admin')} disabled={switching || mode === 'admin'}>
              Dashboard
            </button>
          ) : null}
        </div>
        {switching ? <span className="help">Switching…</span> : null}
      </div>

      <form className="card stack" onSubmit={save}>
        <Field label="Display name">
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Bio">
          <textarea className="textarea" style={{ minHeight: 80 }} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} />
        </Field>
        {msg ? <div className="notice">{msg}</div> : null}
        <div>
          <button className="btn" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <div>
        <button
          className="btn secondary"
          onClick={async () => {
            await signOut();
            router.replace('/');
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
