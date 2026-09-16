import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import { readStoredMode, storeMode, type Mode } from '../lib/mode';
import type { AccountRole, Profile } from '../types';

interface AuthValue {
  user: AuthUser | null;
  profile: Profile | null;
  /** Named in the server's ADMIN_USER_IDS. Decides whether the dashboard is offered as a side; the server decides the rest. */
  isAdmin: boolean;
  /**
   * Which side of the site this visit is on: buying unless they chose to sell and their
   * profile allows it, or chose the dashboard and the server agrees they may.
   */
  mode: Mode;
  /** Switch sides. Selling needs the profile to have it turned on; the dashboard needs the server's list. */
  setMode(mode: Mode): void;
  loading: boolean;
  isDemo: boolean;
  /** Step one: the server checks the password and emails a code. Returns no session. */
  startSignIn(email: string, password: string): Promise<{ challengeId: string; expiresInSeconds: number }>;
  /** Step two: the code buys a session. */
  verifySignIn(challengeId: string, code: string): Promise<void>;
  signUp(email: string, password: string, username: string, role?: AccountRole): Promise<{ needsEmailConfirm: boolean }>;
  signOut(): Promise<void>;
  isUsernameAvailable(username: string): Promise<boolean>;
  sendPasswordReset(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  resendConfirmation(email: string): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  // Read after mount: the server render has no localStorage and must match the first client render.
  const [chosen, setChosen] = useState<Mode | null>(null);

  const loadProfile = useCallback(async (u: AuthUser | null) => {
    if (!u) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }
    const [p, a] = await Promise.all([api.getProfile(u.id).catch(() => null), api.isAdmin().catch(() => false)]);
    setProfile(p);
    setIsAdmin(a);
  }, []);

  useEffect(() => {
    setChosen(readStoredMode());
    let active = true;
    api
      .getCurrentUser()
      .then(async (u) => {
        if (!active) return;
        setUser(u);
        await loadProfile(u);
      })
      .finally(() => active && setLoading(false));
    const unsubscribe = api.onAuthChange(async (u) => {
      setUser(u);
      await loadProfile(u);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadProfile]);

  const setMode = useCallback((m: Mode) => {
    storeMode(m);
    setChosen(m);
  }, []);

  // A remembered side the account cannot have (selling turned off since, an admin id removed
  // from the server, or a different account on the same browser) falls back to buying rather
  // than showing an empty store or a refused dashboard.
  const mode: Mode = chosen === 'admin' && isAdmin ? 'admin' : chosen === 'seller' && profile?.isSeller ? 'seller' : 'buyer';

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      isAdmin,
      mode,
      setMode,
      loading,
      isDemo: api.isDemo,
      startSignIn: (email, password) => api.startSignIn(email, password),
      verifySignIn: (challengeId, code) => api.verifySignIn(challengeId, code),
      signUp: (email, password, username, role) => api.signUp(email, password, username, role),
      signOut: async () => {
        await api.signOut();
        // The choice belonged to this account's visit; the next person to sign in makes their own.
        storeMode(null);
        setChosen(null);
      },
      isUsernameAvailable: (username) => api.isUsernameAvailable(username),
      sendPasswordReset: (email) => api.sendPasswordReset(email),
      updatePassword: (password) => api.updatePassword(password),
      resendConfirmation: (email) => api.resendConfirmation(email),
      // Re-reads the session rather than trusting the closed-over user, which is stale for a
      // moment after sign-in: the auth page refreshes right after turning selling on.
      refreshProfile: async () => loadProfile(await api.getCurrentUser()),
    }),
    [user, profile, isAdmin, mode, setMode, loading, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
