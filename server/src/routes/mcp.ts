/**
 * MCP endpoint (Streamable HTTP) at /mcp.
 * Clients authenticate with `Authorization: Bearer <token from the site's /connect page>`
 * and get read-only tools over the vaults they own. Vault contents come from Sanity.
 *
 * The MCP SDK speaks web-standard Request/Response, so the Fastify request is
 * bridged into one; the body is kept as the raw string it arrived as.
 */
import { McpServer, createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IS_DEMO, cfg } from '../config.ts';
import * as catalog from '../sanity/index.ts';
import { admin } from '../supabase.ts';
import type { Vault } from '../types.ts';

type OwnedVault = Pick<Vault, 'id' | 'title' | 'tagline' | 'version' | 'noteCount' | 'entryNote' | 'updatedAt'>;
type Notes = Map<string, string>;

/* ---------- auth ---------- */

function bearerToken(auth: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(auth ?? '');
  return m?.[1]?.trim() || null;
}

/** Maps a token to a user id, or null. Demo mode accepts any token. */
async function resolveUser(token: string): Promise<string | null> {
  if (IS_DEMO) return 'demo-user';
  const hash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await admin().from('mcp_tokens').select('user_id').eq('token_hash', hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

/* ---------- vault access ---------- */

async function ownedVaults(userId: string): Promise<OwnedVault[]> {
  if (IS_DEMO) return (await catalog.listVaults({ limit: 100 })).items; // demo purchases live in the browser
  const { data, error } = await admin().from('purchases').select('vault_id').eq('buyer_id', userId);
  if (error) throw new Error(error.message);
  const [bought, mine] = await Promise.all([
    catalog.getVaultsByIds((data ?? []).map((p: { vault_id: string }) => p.vault_id)),
    catalog.getSellerVaults(userId, true),
  ]);
  const seen = new Set<string>();
  return [...bought, ...mine].filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
}

async function requireVault(userId: string, vaultId: string): Promise<OwnedVault> {
  const v = (await ownedVaults(userId)).find((x) => x.id === vaultId);
  if (!v) throw new Error(`You do not own a vault with id ${vaultId}. Call list_vaults first.`);
  return v;
}

const cache = new Map<string, Notes>();
const CACHE_LIMIT = 8;

async function loadNotes(v: OwnedVault): Promise<Notes> {
  const key = `${v.id}:${v.updatedAt}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rows = await catalog.getAllNoteContents(v.id);
  const notes: Notes = new Map(rows.map((r) => [r.path, r.content ?? '']));
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, notes);
  return notes;
}

/* ---------- MCP server ---------- */

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (e: unknown) => ({ content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true });

function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: 'vault-market', version: '1.2.0' });

  server.registerTool(
    'list_vaults',
    { title: 'List owned vaults', description: 'Lists the Obsidian vaults this user has bought or published on Vault Market, with their ids and start-here note.', inputSchema: z.object({}) },
    async () => {
      try {
        const vaults = await ownedVaults(userId);
        if (!vaults.length) return text('No vaults yet. Buy or grab a free vault on Vault Market first.');
        return text(vaults.map((v) => `- ${v.title} (id: ${v.id}, v${v.version}, ~${v.noteCount} notes${v.entryNote ? `, start: ${v.entryNote}` : ''})\n  ${v.tagline}`).join('\n'));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'list_notes',
    {
      title: 'List notes in a vault',
      description: 'Lists note paths inside a vault. Optionally restrict to a folder prefix.',
      inputSchema: z.object({ vault_id: z.string().describe('Vault id from list_vaults'), folder: z.string().optional().describe('Folder prefix, e.g. "Templates"') }),
    },
    async ({ vault_id, folder }) => {
      try {
        const notes = await loadNotes(await requireVault(userId, vault_id));
        const prefix = folder ? folder.replace(/^\/+|\/+$/g, '') + '/' : '';
        const paths = [...notes.keys()].filter((p) => p.startsWith(prefix)).sort();
        if (!paths.length) return text(prefix ? `No notes under ${prefix}` : 'This vault has no notes.');
        return text(paths.slice(0, 500).join('\n') + (paths.length > 500 ? `\n… ${paths.length - 500} more` : ''));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'read_note',
    { title: 'Read a note', description: 'Returns the full markdown of one note by path.', inputSchema: z.object({ vault_id: z.string(), path: z.string().describe('Path from list_notes, e.g. "Templates/Daily note.md"') }) },
    async ({ vault_id, path }) => {
      try {
        const notes = await loadNotes(await requireVault(userId, vault_id));
        const clean = path.replace(/^\/+/, '');
        const body = notes.get(clean) ?? notes.get(`${clean}.md`);
        if (body === undefined) return fail(new Error(`No note at ${clean}`));
        return text(body);
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search a vault',
      description: 'Case-insensitive full-text search across a vault. Returns matching paths with a snippet.',
      inputSchema: z.object({ vault_id: z.string(), query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) }),
    },
    async ({ vault_id, query, limit }) => {
      try {
        const notes = await loadNotes(await requireVault(userId, vault_id));
        const q = query.toLowerCase();
        const hits: string[] = [];
        for (const [p, body] of notes) {
          const i = body.toLowerCase().indexOf(q);
          if (i === -1 && !p.toLowerCase().includes(q)) continue;
          const snippet = i === -1 ? '' : body.slice(Math.max(0, i - 80), i + q.length + 80).replace(/\s+/g, ' ');
          hits.push(`${p}${snippet ? `\n  …${snippet}…` : ''}`);
          if (hits.length >= limit) break;
        }
        return text(hits.length ? hits.join('\n') : `No notes match "${query}".`);
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}

// One handler per user, reused across requests in this process.
const handlers = new Map<string, McpHttpHandler>();
function handlerFor(userId: string): McpHttpHandler {
  let h = handlers.get(userId);
  if (!h) {
    h = createMcpHandler(() => buildServer(userId), { responseMode: 'json' });
    if (handlers.size >= 200) handlers.delete(handlers.keys().next().value!);
    handlers.set(userId, h);
  }
  return h;
}

/* ---------- Fastify bridge ---------- */

export default async function mcpRoutes(app: FastifyInstance) {
  // Keep the raw JSON so the MCP SDK parses it itself.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.route<{ Body: string }>({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (req, reply) => {
      if (!catalog.SANITY_ENABLED) return reply.code(501).send({ error: 'Catalog is not configured' });
      const token = bearerToken(req.headers.authorization);
      if (!token) return reply.code(401).header('WWW-Authenticate', 'Bearer realm="vault-market"').send({ error: 'Missing bearer token. Create one on the Connect page.' });
      const userId = await resolveUser(token);
      if (!userId) return reply.code(401).header('WWW-Authenticate', 'Bearer realm="vault-market"').send({ error: 'Invalid or revoked token. Generate a new one on the Connect page.' });

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const body = req.method === 'POST' ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})) : undefined;
      const res = await handlerFor(userId).fetch(new Request(`${cfg.apiUrl}${req.url}`, { method: req.method, headers, body }));

      reply.code(res.status);
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-length') reply.header(key, value);
      });
      return reply.send(Buffer.from(await res.arrayBuffer()));
    },
  });
}
