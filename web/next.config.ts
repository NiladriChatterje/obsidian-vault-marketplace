import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import path from 'node:path';

// The website reads the repo-root .env (shared with the server and the app) in addition to its own .env files.
loadEnvConfig(path.join(__dirname, '..'), process.env.NODE_ENV !== 'production');

const nextConfig: NextConfig = {
  // Inlined into the browser bundle at build time (same names as the Expo app, so one .env serves both).
  env: {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT: process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT ?? '10',
    EXPO_PUBLIC_REDIRECT_ORIGIN: process.env.EXPO_PUBLIC_REDIRECT_ORIGIN ?? '',
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? '',
    EXPO_PUBLIC_CATALOG_SOURCE: process.env.EXPO_PUBLIC_CATALOG_SOURCE ?? '',
  },
  // Standalone output is only for web/Dockerfile. Vercel packages the build itself, and
  // combining the two breaks its post-build step on Next 16.3.x (missing next-server.js.nft.json).
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
