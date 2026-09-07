'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/store/auth';

/** Client boundary so the shared (browser-side) auth store can wrap server-rendered pages. */
export function Providers({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
