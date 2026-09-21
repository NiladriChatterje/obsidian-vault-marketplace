/**
 * Sync routes for the Obsidian plugin (obsidian-plugin/): a buyer installs a vault into their
 * own vault and updates it in place, instead of downloading a zip and merging it by hand.
 *
 *   GET  /sync/vaults                        the vaults this token owns, with their versions
 *   GET  /sync/vaults/:id/manifest           every file with a sha-256 of its body
 *   POST /sync/vaults/:id/files { paths }    the bodies the plugin decided it needs
 *
 * The plugin never fetches a body it already has: it compares three hashes per path — the one
 * it recorded at install, the one on disk now, and the one in the manifest — and asks only for
 * what actually changed. So an update over a 400-note vault is one manifest and a handful of
 * notes, and the server does the same reads it would for the reader.
 *
 * Auth is the personal token from the Connect page, the same one MCP takes (token-access.ts).
 * Read-only over owned vaults: a leaked token cannot spend, publish or delete.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as catalog from '../catalog/index.ts';
import { bearerToken, ownedVaults, resolveTokenUser } from '../token-access.ts';
import type { Vault } from '../types.ts';

/** How many bodies one call may ask for. A first install pages through the manifest. */
const MAX_PATHS = 200;

/** Keys are built as bundles/<bundle>/<path>, so a path may not climb out of its prefix. */
function safePath(p: unknown): p is string {
  return typeof p === 'string' && !!p && !p.startsWith('/') && !p.split('/').includes('..') && p.length <= 400;
}

export default async function syncRoutes(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    if (!catalog.CATALOG_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured' });
    const token = bearerToken(req.headers.authorization);
    const userId = token ? await resolveTokenUser(token) : null;
    if (!userId) {
      return reply
        .code(401)
        .header('WWW-Authenticate', 'Bearer realm="vault-market"')
        .send({ error: 'Paste a token from the Connect page into the plugin settings.' });
    }
    (req as FastifyRequest & { userId?: string }).userId = userId;
  });

  /** The owned vault this request is about, or a 403. Ownership is a purchase row or being the seller. */
  async function vaultFor(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<Vault | null> {
    const userId = (req as FastifyRequest & { userId: string }).userId;
    const vault = (await ownedVaults(userId)).find((v) => v.id === req.params.id);
    if (!vault) {
      reply.code(403).send({ error: 'Buy this vault to install it.' });
      return null;
    }
    return vault;
  }

  app.get('/sync/vaults', async (req) => {
    const vaults = await ownedVaults((req as FastifyRequest & { userId: string }).userId);
    return vaults
      .filter((v) => !!v.filePath) // a listing with nothing attached has nothing to install
      .map((v) => ({ id: v.id, title: v.title, tagline: v.tagline, version: v.version, noteCount: v.noteCount, entryNote: v.entryNote, updatedAt: v.updatedAt }));
  });

  app.get<{ Params: { id: string } }>('/sync/vaults/:id/manifest', async (req, reply) => {
    const vault = await vaultFor(req, reply);
    if (!vault) return;
    return {
      vaultId: vault.id,
      title: vault.title,
      version: vault.version,
      entryNote: vault.entryNote,
      updatedAt: vault.updatedAt,
      files: await catalog.vaultManifest(vault.id),
    };
  });

  app.post<{ Params: { id: string }; Body: { paths?: unknown } }>('/sync/vaults/:id/files', async (req, reply) => {
    const vault = await vaultFor(req, reply);
    if (!vault) return;
    const raw = req.body?.paths;
    if (!Array.isArray(raw) || !raw.length) return reply.code(400).send({ error: 'Send { paths: [...] }' });
    if (raw.length > MAX_PATHS) return reply.code(400).send({ error: `Ask for at most ${MAX_PATHS} paths at a time` });
    const paths = raw.filter(safePath);
    if (!paths.length) return reply.code(400).send({ error: 'No usable paths' });
    return { files: await catalog.readVaultFiles(vault.id, paths) };
  });
}
