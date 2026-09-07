import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type AuthUser } from '../lib/api';
import type { Profile } from '../types';

interface AuthValue {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  isDemo: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, username: string): Promise<{ needsEmailConfirm: boolean }>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (u: AuthUser | null) => {
    if (!u) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.getProfile(u.id));
    } catch {
      setProfile(null);
    }
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
      loading,
      isDemo: api.isDemo,
      signIn: (email, password) => api.signIn(email, password),
      signUp: (email, password, username) => api.signUp(email, password, username),
      signOut: () => api.signOut(),
      refreshProfile: () => loadProfile(user),
    }),
    [user, profile, loading, loadProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
