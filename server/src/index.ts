/**
 * Vault Market payment server (Fastify).
 * Owns everything with a secret:
 * the Dodo Payments checkout and its webhook, the vault catalog (Postgres + the vault store),
 * the seller ledger and admin dashboard, and the MCP endpoint over purchased vaults.
 *
 *   npm run dev      # reads ../.env, restarts on change
 */
import './env.ts'; // must stay first: shared modules read process.env when imported
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { CATALOG_ENABLED } from './catalog/index.ts';
import { IS_DEMO, cfg } from './config.ts';
import { EMAIL_ENABLED } from './email.ts';
import { MALWARE_SCAN_ENABLED } from './malware.ts';
import { REDIS_ENABLED } from './redis.ts';
import { UPLOAD_QUEUE_ENABLED } from './upload-queue.ts';
import { VAULT_STORE_ENABLED } from './vault-store.ts';
import { DODO_ENABLED } from './dodo.ts';
import { startKeepAwake } from './keepalive.ts';
import { startPayoutWatch } from './payout-watch.ts';
import authRoutes from './routes/auth.ts';
import catalogRoutes from './routes/catalog.ts';
import adminPayoutRoutes from './routes/admin-payouts.ts';
import dodoWebhookRoutes from './routes/dodo.ts';
import insightsRoutes from './routes/insights.ts';
import payoutRoutes from './routes/payouts.ts';
import checkoutRoutes from './routes/checkout.ts';
import mcpRoutes from './routes/mcp.ts';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  // A download token (/downloads/:token) is a signed base64 payload, ~150 characters; the
  // default ceiling of 100 on a route parameter would answer it with 414 before the handler.
  maxParamLength: 512,
});

await app.register(cors, { origin: cfg.allowedRedirectOrigins.length ? cfg.allowedRedirectOrigins : true });

app.get('/health', async () => ({
  ok: true,
  mode: IS_DEMO ? 'demo (no Supabase: orders in memory)' : 'supabase',
  // Dodo is the only rail; without a key no paid checkout can be created at all.
  provider: 'dodo',
  dodo: DODO_ENABLED ? { configured: true, mode: cfg.dodo.live ? 'live' : 'test', webhook: !!cfg.dodo.webhookSecret } : { configured: false },
  email: EMAIL_ENABLED ? { provider: 'brevo', from: cfg.brevo.senderEmail } : null,
  // Sign-in codes live here, so without it nobody can complete a sign-in.
  redis: REDIS_ENABLED,
  // Off means uploaded vaults reach the store unscanned; see malware.ts.
  uploadScan: MALWARE_SCAN_ENABLED,
  // On means zips go through the store and a worker; off, POST /uploads/vault-zip does it inline.
  uploadQueue: UPLOAD_QUEUE_ENABLED,
  // Listings in Postgres, bytes in the vault store; both are needed for any catalog route.
  catalog: CATALOG_ENABLED ? { source: 'postgres', store: cfg.vaultStore.bucket } : { source: 'none', supabase: !IS_DEMO, vaultStore: VAULT_STORE_ENABLED },
}));

await app.register(authRoutes); // the only unauthenticated POSTs: the caller has no session yet
await app.register(catalogRoutes); // own scope: multipart parser for zip uploads
await app.register(checkoutRoutes);
await app.register(payoutRoutes);
await app.register(adminPayoutRoutes);
await app.register(insightsRoutes); // who bought what: seller insights and the admin dashboard
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
startPayoutWatch(app.log); // mails when a seller has cleared enough to be worth paying
