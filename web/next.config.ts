import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import path from 'node:path';

// One .env for both apps: the site reads the repo-root .env (EXPO_PUBLIC_* + SUPABASE_SERVICE_ROLE_KEY).
const repoRoot = path.join(__dirname, '..');
loadEnvConfig(repoRoot, process.env.NODE_ENV !== 'production');

/**
 * The site reuses the Expo app's data layer (../src/lib, ../src/store, ../src/types).
 * The few React Native modules that layer touches are swapped for browser shims.
 */
const shims = {
  'react-native': 'shims/react-native.ts',
  'react-native-url-polyfill/auto': 'shims/empty.ts',
  '@react-native-async-storage/async-storage': 'shims/async-storage.ts',
  'expo-file-system': 'shims/expo-file-system.ts',
};
const abs = (p: string) => path.join(__dirname, p);

const nextConfig: NextConfig = {
  env: {
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    EXPO_PUBLIC_PLATFORM_FEE_PERCENT: process.env.EXPO_PUBLIC_PLATFORM_FEE_PERCENT ?? '15',
    EXPO_PUBLIC_REDIRECT_ORIGIN: process.env.EXPO_PUBLIC_REDIRECT_ORIGIN ?? '',
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? '',
    EXPO_PUBLIC_CATALOG_SOURCE: process.env.EXPO_PUBLIC_CATALOG_SOURCE ?? '',
  },
  // Standalone output for the Docker image (web/Dockerfile); traces files from the repo root because ../src is imported.
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    // Turbopack wants project-relative specifiers (absolute Windows paths are rejected).
    resolveAlias: Object.fromEntries(Object.entries(shims).map(([k, v]) => [k, `./${v}`])),
  },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(Object.entries(shims).map(([k, v]) => [k, abs(v)])) };
    return config;
  },
};

export default nextConfig;
