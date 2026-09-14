import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import type { AccountRole, Profile } from '../types';

interface AuthValue {
  user: AuthUser | null;
  profile: Profile | null;
  /** Named in the server's ADMIN_USER_IDS. Decides whether the admin link is shown; the server decides the rest. */
  isAdmin: boolean;
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

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      isAdmin,
      loading,
      isDemo: api.isDemo,
      signIn: (email, password) => api.signIn(email, password),
      signUp: (email, password, username, role) => api.signUp(email, password, username, role),
      signOut: () => api.signOut(),
      isUsernameAvailable: (username) => api.isUsernameAvailable(username),
      sendPasswordReset: (email) => api.sendPasswordReset(email),
      updatePassword: (password) => api.updatePassword(password),
      resendConfirmation: (email) => api.resendConfirmation(email),
      refreshProfile: async () => loadProfile(await api.getCurrentUser()),
    }),
    [user, profile, isAdmin, loading, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
