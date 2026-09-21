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
 *
 * Fingerprinting (fingerprint.ts) changes what a *body* is, so it changes what a *hash* is.
 * Both have to move together: the manifest must promise the hash of the note the plugin will
 * actually write, marked, or the next update would find every file edited. That is the one
 * invariant this file exists to hold.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as catalog from '../catalog/index.ts';
import { FINGERPRINT_ENABLED, isStampable, markFor, stampNote } from '../fingerprint.ts';
import { bearerToken, ownedVaults, resolveTokenUser } from '../token-access.ts';
import type { Vault } from '../types.ts';

/** How many bodies one call may ask for. A first install pages through the manifest. */
const MAX_PATHS = 200;

interface ManifestFile {
  path: string;
  hash: string;
  sizeBytes: number;
}

/** Keys are built as bundles/<bundle>/<path>, so a path may not climb out of its prefix. */
function safePath(p: unknown): p is string {
  return typeof p === 'string' && !!p && !p.startsWith('/') && !p.split('/').includes('..') && p.length <= 400;
}

/**
 * One buyer's manifest, keyed by vault version as well as buyer so a re-upload invalidates it.
 * Only needed when fingerprinting is on: the marked hashes cannot come from the index, so the
 * bodies are read once here and the update that follows costs nothing.
 */
const views = new Map<string, ManifestFile[]>();
const VIEW_LIMIT = 200;

async function manifestFor(vault: Vault, userId: string): Promise<ManifestFile[]> {
  const stored = await catalog.vaultManifest(vault.id);
  if (!FINGERPRINT_ENABLED) return stored;

  const key = `${vault.id}:${vault.updatedAt}:${userId}`;
  const hit = views.get(key);
  if (hit) return hit;

  const mark = markFor(vault.id, userId);
  const paths = stored.filter((f) => isStampable(f.path)).map((f) => f.path);
  const bodies = new Map((await catalog.readVaultFiles(vault.id, paths)).map((f) => [f.path, f.content]));
  const files = stored.map((f) => {
    const body = bodies.get(f.path);
    if (body === undefined) return f; // not a note, or the object is gone; its stored hash stands
    const stamped = Buffer.from(stampNote(body, mark), 'utf8');
    return { path: f.path, hash: createHash('sha256').update(stamped).digest('hex'), sizeBytes: stamped.byteLength };
  });

  if (views.size >= VIEW_LIMIT) views.delete(views.keys().next().value!);
  views.set(key, files);
  return files;
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
      files: await manifestFor(vault, (req as FastifyRequest & { userId: string }).userId),
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

    const files = await catalog.readVaultFiles(vault.id, paths);
    if (!FINGERPRINT_ENABLED) return { files };
    // The same stamp the manifest hashed, or the plugin would rewrite every note on the next update.
    const mark = markFor(vault.id, (req as FastifyRequest & { userId: string }).userId);
    return { files: files.map((f) => (isStampable(f.path) ? { path: f.path, content: stampNote(f.content, mark) } : f)) };
  });
}
