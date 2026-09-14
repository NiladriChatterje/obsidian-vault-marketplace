'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, Field, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { api } from '@/lib/api';
import { landingFor } from '@/lib/onboarding';
import { useAuth } from '@/store/auth';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, signOut, refreshProfile, mode, setMode } = useAuth();
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
   * Cross to the other side of the site. Selling is turned on for the profile the first time,
   * and a seller with nowhere to be paid yet is taken to say where, as at sign-in.
   */
  const switchTo = async (role: 'buyer' | 'seller') => {
    setSwitching(true);
    setSwitchError(null);
    try {
      if (role === 'seller' && !profile?.isSeller) {
        await api.updateProfile({ isSeller: true });
        await refreshProfile();
      }
      setMode(role);
      router.push(await landingFor(role, role === 'seller' ? '/sell' : '/'));
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

      {/* One account can buy and sell; the site shows one side at a time. This is where to cross over. */}
      <div className="card stack">
        <div>
          <strong>{mode === 'admin' ? 'Administrator' : mode === 'seller' ? 'You are selling' : 'You are buying'}</strong>
          <p className="muted small" style={{ marginTop: 4 }}>
            {mode === 'admin'
              ? 'This account runs the marketplace, so it sees the dashboard and nothing else.'
              : mode === 'seller'
                ? 'Your tabs are your store, new listings and payouts. Switch to buying to browse and use your library.'
                : profile?.isSeller
                  ? 'Your tabs are Explore, Library and MCP. Switch to selling to see your store, listings and payouts.'
                  : 'Your tabs are Explore, Library and MCP. Start selling to list your own vaults; you will be asked where to send your earnings.'}
          </p>
        </div>
        {switchError ? <div className="error">{switchError}</div> : null}
        {mode === 'admin' ? null : mode === 'seller' ? (
          <div>
            <button className="btn secondary" onClick={() => switchTo('buyer')} disabled={switching}>
              {switching ? 'Switching…' : 'Switch to buying'}
            </button>
          </div>
        ) : (
          <div>
            <button className="btn secondary" onClick={() => switchTo('seller')} disabled={switching}>
              {switching ? 'Switching…' : profile?.isSeller ? 'Switch to selling' : 'Start selling'}
            </button>
          </div>
        )}
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
