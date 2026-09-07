/**
 * Vault Market payment server (Fastify).
 * Owns everything that needs the Razorpay secret: creating orders, hosting the
 * checkout page, verifying payment signatures, receiving webhooks, and
 * onboarding sellers to Razorpay Route.
 *
 *   npm run dev      # reads ../.env, restarts on change
 */
import './env.ts'; // must stay first: shared modules read process.env when imported
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { createClient } from '@sanity/client';
import { SANITY_API_TOKEN, SANITY_DATASET, SANITY_ENABLED, SANITY_PROJECT_ID, useSanityClientFactory } from '../../src/lib/sanity/index.ts';
import { IS_DEMO, cfg } from './config.ts';
import catalogRoutes from './routes/catalog.ts';
import checkoutRoutes from './routes/checkout.ts';
import payoutRoutes from './routes/payouts.ts';
import webhookRoutes from './routes/webhook.ts';

useSanityClientFactory(createClient);

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

await app.register(cors, { origin: cfg.allowedRedirectOrigins.length ? cfg.allowedRedirectOrigins : true });
await app.register(formbody); // Checkout.js posts the callback as application/x-www-form-urlencoded

app.get('/health', async () => ({
  ok: true,
  mode: IS_DEMO ? 'demo (no Supabase: orders in memory)' : 'supabase',
  razorpayKey: cfg.razorpay.keyId.replace(/^(rzp_\w+_).+$/, '$1…'),
  merchantId: cfg.razorpay.merchantId || null,
  route: cfg.razorpay.route,
  webhookConfigured: !!cfg.razorpay.webhookSecret,
  catalog: SANITY_ENABLED ? { source: 'sanity', projectId: SANITY_PROJECT_ID, dataset: SANITY_DATASET, canWrite: !!SANITY_API_TOKEN } : { source: 'none' },
}));

await app.register(catalogRoutes); // own scope: multipart parser for zip uploads
await app.register(checkoutRoutes);
await app.register(payoutRoutes);
await app.register(webhookRoutes); // own plugin scope: keeps the raw JSON body for signature checks

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  req.log.error(err);
  const status = err.statusCode ?? 500;
  reply.code(status).send({ error: err.message || 'Unexpected error' });
});

await app.listen({ port: cfg.port, host: '0.0.0.0' });
app.log.info(`Vault Market API on ${cfg.apiUrl} (${IS_DEMO ? 'demo' : 'supabase'} mode)`);
