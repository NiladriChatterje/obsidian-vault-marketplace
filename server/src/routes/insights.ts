/**
 * Who bought what, and what they said. Two audiences, one shape.
 *
 * For a seller, about their own listings:
 *   GET /me/insights                 how each of my vaults has sold
 *   GET /me/vaults/:id/insights      one vault's buyers and reviews in full
 *
 * For the operator, gated on ADMIN_USER_IDS like the payout ledger:
 *   GET /admin/access                { admin } for whoever is signed in, never an error
 *   GET /admin/overview              every vault, how it sold, and the latest purchases
 *   GET /admin/vaults/:id            one vault's buyers and reviews in full
 *
 * Demo mode keeps purchases in the browser, so the server has nothing to report and the
 * client answers these from its own store instead.
 */
import type { FastifyInstance } from 'fastify';
import { isAdminId, requireAdmin } from '../admin.ts';
import { requireRequester } from '../access.ts';
import { IS_DEMO, cfg } from '../config.ts';
import { adminOverview, salesForVaults, vaultInsights } from '../insights.ts';
import * as catalog from '../sanity/index.ts';
import { userFromRequest } from '../supabase.ts';

export default async function insightsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (_req, reply) => {
    if (!catalog.SANITY_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured (SANITY_PROJECT_ID / CATALOG_SOURCE).' });
  });

  /* ---------- seller ---------- */

  app.get('/me/insights', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    if (r.demo) return [];
    const mine = await catalog.getSellerVaults(r.id, true);
    return salesForVaults(mine.map((v) => v.id));
  });

  app.get<{ Params: { id: string } }>('/me/vaults/:id/insights', async (req, reply) => {
    const r = await requireRequester(req, reply);
    if (!r) return;
    const v = await catalog.getVault(req.params.id);
    // Not found rather than forbidden: whether someone else's listing exists is not theirs to learn here.
    if (!v || v.sellerId !== r.id) return reply.code(404).send({ error: 'Listing not found' });
    if (r.demo) return reply.code(501).send({ error: 'Insights need Supabase configured on the server' });
    return vaultInsights(v.id, v);
  });

  /* ---------- operator ---------- */

  /** A plain answer for the site to decide whether to show the admin link; the routes below still refuse on their own. */
  app.get('/admin/access', async (req) => {
    if (IS_DEMO || !cfg.adminUserIds.length) return { admin: false };
    const u = await userFromRequest(req);
    return { admin: !!u && isAdminId(u.id) };
  });

  app.get('/admin/overview', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return adminOverview();
  });

  app.get<{ Params: { id: string } }>('/admin/vaults/:id', async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const insights = await vaultInsights(req.params.id);
    if (!insights.vault && !insights.purchases.length && !insights.reviews.length) return reply.code(404).send({ error: 'Vault not found' });
    return insights;
  });
}
