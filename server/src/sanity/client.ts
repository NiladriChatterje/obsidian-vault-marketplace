/**
 * Sanity client for server-side code (Fastify payment/catalog server and the
 * Next.js MCP route). Note bodies are paid content, so the dataset should be
 * private and every read goes through here with SANITY_API_TOKEN; the app and
 * site never talk to Sanity directly.
 *
 * The consumer hands in `createClient` via `useSanityClientFactory` so this module
 * stays framework-free and easy to unit test.
 * Imports inside this folder carry a .ts extension so plain Node can run them.
 */
import type { ClientConfig, SanityClient } from '@sanity/client';

type ClientFactory = (config: ClientConfig) => SanityClient;
let factory: ClientFactory | null = null;

/** Call once at startup: `useSanityClientFactory(createClient)` with the app's own @sanity/client. */
export function useSanityClientFactory(f: ClientFactory): void {
  factory = f;
  client = null;
}

const env = (k: string) => (typeof process !== 'undefined' ? process.env[k] : undefined) ?? '';

export const SANITY_PROJECT_ID = env('SANITY_PROJECT_ID') || env('NEXT_PUBLIC_SANITY_PROJECT_ID') || env('EXPO_PUBLIC_SANITY_PROJECT_ID') || '8775uk5l';
export const SANITY_DATASET = env('SANITY_DATASET') || env('NEXT_PUBLIC_SANITY_DATASET') || env('EXPO_PUBLIC_SANITY_DATASET') || 'production';
export const SANITY_API_TOKEN = env('SANITY_API_TOKEN');
export const SANITY_API_VERSION = '2025-02-19';

/** True when a project id is known. Writes additionally need SANITY_API_TOKEN. */
export const SANITY_ENABLED = !!SANITY_PROJECT_ID && env('CATALOG_SOURCE') !== 'local';

let client: SanityClient | null = null;

export function sanity(): SanityClient {
  if (!SANITY_ENABLED) throw new Error('Sanity is not configured (SANITY_PROJECT_ID).');
  if (!factory) throw new Error('Sanity client not initialised: call useSanityClientFactory(createClient) first.');
  return (client ??= factory({
    projectId: SANITY_PROJECT_ID,
    dataset: SANITY_DATASET,
    apiVersion: SANITY_API_VERSION,
    token: SANITY_API_TOKEN || undefined,
    // The CDN never sees private datasets or fresh writes; go to the API when we hold a token.
    useCdn: !SANITY_API_TOKEN,
    perspective: 'published',
  }));
}

export function requireWriteToken(): void {
  if (!SANITY_API_TOKEN) throw new Error('SANITY_API_TOKEN (Editor) is required to write to Sanity.');
}
