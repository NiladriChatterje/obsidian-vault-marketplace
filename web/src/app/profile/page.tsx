'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, Field, Loading } from '@/components/ui';
import { errorMessage } from '@/lib/web';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function ProfilePage() {
  const router = useRouter();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
        {profile?.id ? (
          <Link href={`/seller/${profile.id}`} className="muted small">
            View public profile →
          </Link>
        ) : null}
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
