/**
 * Vault Market payment server (Fastify).
 * Owns everything with a secret:
 * the Dodo Payments checkout and its webhook, the Sanity-backed vault catalog, and the
 * MCP endpoint over purchased vaults.
 *
 *   npm run dev      # reads ../.env, restarts on change
 */
import './env.ts'; // must stay first: shared modules read process.env when imported
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { createClient } from '@sanity/client';
import { SANITY_API_TOKEN, SANITY_DATASET, SANITY_ENABLED, SANITY_PROJECT_ID, useSanityClientFactory } from './sanity/index.ts';
import { IS_DEMO, cfg } from './config.ts';
import { EMAIL_ENABLED } from './email.ts';
import { DODO_ENABLED } from './dodo.ts';
import { startKeepAwake } from './keepalive.ts';
import catalogRoutes from './routes/catalog.ts';
import dodoWebhookRoutes from './routes/dodo.ts';
import checkoutRoutes from './routes/checkout.ts';
import mcpRoutes from './routes/mcp.ts';

useSanityClientFactory(createClient);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cors, { origin: cfg.allowedRedirectOrigins.length ? cfg.allowedRedirectOrigins : true });

app.get('/health', async () => ({
  ok: true,
  mode: IS_DEMO ? 'demo (no Supabase: orders in memory)' : 'supabase',
  // Dodo is the only rail; without a key no paid checkout can be created at all.
  provider: 'dodo',
  dodo: DODO_ENABLED ? { configured: true, mode: cfg.dodo.live ? 'live' : 'test', webhook: !!cfg.dodo.webhookSecret } : { configured: false },
  email: EMAIL_ENABLED ? { provider: 'brevo', from: cfg.brevo.senderEmail } : null,
  catalog: SANITY_ENABLED ? { source: 'sanity', projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET, canWrite: !!SANITY_API_TOKEN } : { source: 'none' },
}));

await app.register(catalogRoutes); // own scope: multipart parser for zip uploads
await app.register(checkoutRoutes);
await app.register(dodoWebhookRoutes); // same, for Dodo's Standard Webhooks signature
await app.register(mcpRoutes); // own plugin scope: raw JSON for the MCP SDK

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error(err);
  const status = err.statusCode ?? 500;
  reply.code(status).send({ error: err.message || 'Unexpected error' });
});

await app.listen({ port: cfg.port, host: '0.0.0.0' });
app.log.info(`Vault Market API on ${cfg.apiUrl} (${IS_DEMO ? 'demo' : 'supabase'} mode)`);
startKeepAwake(app.log); // free tiers idle the instance out; see keepalive.ts
