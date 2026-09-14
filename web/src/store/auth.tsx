import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import { readStoredRole, storeRole, type Mode } from '../lib/mode';
import type { AccountRole, Profile } from '../types';

interface AuthValue {
  user: AuthUser | null;
  profile: Profile | null;
  /** Named in the server's ADMIN_USER_IDS. Decides whether the admin link is shown; the server decides the rest. */
  isAdmin: boolean;
  /**
   * Which side of the site this visit is on. Administrators are always on the dashboard;
   * everyone else is buying unless they chose to sell and their profile allows it.
   */
  mode: Mode;
  /** Switch between buying and selling. Selling needs the profile to have it turned on. */
  setMode(role: AccountRole): void;
  loading: boolean;
  isDemo: boolean;
  signIn(email: string, password: string): Promise<void>;
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
  const [role, setRole] = useState<AccountRole | null>(null);

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
    setRole(readStoredRole());
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

  const setMode = useCallback((r: AccountRole) => {
    storeRole(r);
    setRole(r);
  }, []);

  // A remembered "seller" from a profile that is not one (turned off since, or a different
  // account on the same browser) falls back to buying rather than showing an empty store.
  const mode: Mode = isAdmin ? 'admin' : role === 'seller' && profile?.isSeller ? 'seller' : 'buyer';

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      isAdmin,
      mode,
      setMode,
      loading,
      isDemo: api.isDemo,
      signIn: (email, password) => api.signIn(email, password),
      signUp: (email, password, username, role) => api.signUp(email, password, username, role),
      signOut: async () => {
        await api.signOut();
        // The choice belonged to this account's visit; the next person to sign in makes their own.
        storeRole(null);
        setRole(null);
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
