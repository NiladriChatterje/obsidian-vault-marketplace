import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';
import path from 'node:path';

// The website reads the repo-root .env (shared with the payment server) in addition to its own .env files.
loadEnvConfig(path.join(__dirname, '..'), process.env.NODE_ENV !== 'production');

const nextConfig: NextConfig = {
  // No `env` block: every variable the browser needs is named NEXT_PUBLIC_*, which Next
  // inlines on its own. The old allow-list had to be kept in step by hand with what the
  // client read, and silently fell back to defaults whenever it was not.
  // Standalone output is only for web/Dockerfile. Vercel packages the build itself, and
  // combining the two breaks its post-build step on Next 16.3.x (missing next-server.js.nft.json).
  output: process.env.VERCEL ? undefined : 'standalone',
};

export default nextConfig;
