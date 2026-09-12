import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import path from 'node:path';

// The website reads the repo-root .env (shared with the server and the app) in addition to its own .env files.
loadEnvConfig(path.join(__dirname, '..'), process.env.NODE_ENV !== 'production');

const nextConfig: NextConfig = {
  /**
   * Inlined into the browser bundle at build time (same names as the Expo app, so one .env
   * serves both).
   *
   * This list is the whole contract: a variable the client reads and this block omits is
   * simply absent at runtime, and the code falls back to its default with no error. So every
   * `process.env.EXPO_PUBLIC_*` in web/src must appear here, and the defaults must match the
   * ones in src/lib/config.ts or a missing variable changes behaviour rather than preserving
   * it.
   */
  env: {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    EXPO_PUBLIC_REDIRECT_ORIGIN: process.env.EXPO_PUBLIC_REDIRECT_ORIGIN ?? '',
    SERVER_API_URL: process.env.SERVER_API_URL ?? '',
    EXPO_PUBLIC_CATALOG_SOURCE: process.env.EXPO_PUBLIC_CATALOG_SOURCE ?? '',
    // Pricing. The seller-facing fee breakdown is computed from these in the browser.
    EXPO_PUBLIC_PLATFORM_COUNTRY: process.env.EXPO_PUBLIC_PLATFORM_COUNTRY ?? 'IN',
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC: process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT_DOMESTIC ?? '8',
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL: process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT_INTERNATIONAL ?? '12',
    EXPO_PUBLIC_PLATFORM_FEE_FIXED_CENTS: process.env.EXPO_PUBLIC_PLATFORM_FEE_FIXED_CENTS ?? '4000',
    EXPO_PUBLIC_PROVIDER_PERCENT_FEE: process.env.EXPO_PUBLIC_PROVIDER_PERCENT_FEE ?? '4',
    EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS: process.env.EXPO_PUBLIC_PROVIDER_FIXED_FEE_CENTS ?? '3500',
  },
  // Standalone output is only for web/Dockerfile. Vercel packages the build itself, and
  // combining the two breaks its post-build step on Next 16.3.x (missing next-server.js.nft.json).
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
