/**
 * Server side of MCP access. Runs only inside app/api/mcp (Node runtime).
 *
 * A bearer token identifies the buyer; the tools then operate on the vaults
 * that buyer owns (purchases + their own listings). Vault zips are pulled from
 * the private `vault-files` bucket with the service role key, unpacked in
 * memory and cached per process.
 */
import { McpServer } from '@modelcontextprotocol/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { STORAGE_BUCKETS } from '@shared/lib/config';
import { DEMO_VAULTS } from '@shared/lib/demo-data';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
export const IS_DEMO = !SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const TEXT_EXT = /\.(md|markdown|canvas|txt|base|csv|json)$/i;
const MAX_NOTE_BYTES = 2 * 1024 * 1024;
const CACHE_LIMIT = 8;

interface OwnedVault {
  id: string;
  title: string;
  tagline: string;
  description: string;
  version: string;
  noteCount: number;
  plugins: string[];
  tags: string[];
  filePath: string | null;
  updatedAt: string;
}

type Notes = Map<string, string>;

let admin: SupabaseClient | null = null;
function adminClient(): SupabaseClient {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on the server.');
  return (admin ??= createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }));
}

/* ---------- auth ---------- */

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m?.[1]?.trim() || null;
}

/** Maps a token to a user id, or null. Demo mode accepts any token. */
export async function resolveUser(token: string): Promise<string | null> {
  if (IS_DEMO) return 'demo-user';
  const hash = createHash('sha256').update(token).digest('hex');
  const { data, error } = await adminClient().from('mcp_tokens').select('user_id').eq('token_hash', hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.user_id ?? null;
}

/* ---------- vault access ---------- */

async function ownedVaults(userId: string): Promise<OwnedVault[]> {
  if (IS_DEMO) {
    return DEMO_VAULTS.filter((v) => v.status === 'published').map((v) => ({
      id: v.id,
      title: v.title,
      tagline: v.tagline,
      description: v.description,
      version: v.version,
      noteCount: v.noteCount,
      plugins: v.plugins,
      tags: v.tags,
      filePath: null,
      updatedAt: v.updatedAt,
    }));
  }
  const sb = adminClient();
  const { data: purchases, error } = await sb.from('purchases').select('vault_id').eq('buyer_id', userId);
  if (error) throw new Error(error.message);
  const ids = new Set((purchases ?? []).map((p: { vault_id: string }) => p.vault_id));
  const { data: vaults, error: vErr } = await sb
    .from('vaults')
    .select('id, title, tagline, description, version, note_count, plugins, tags, file_path, updated_at, seller_id')
    .or(`seller_id.eq.${userId}${ids.size ? `,id.in.(${[...ids].join(',')})` : ''}`);
  if (vErr) throw new Error(vErr.message);
  return (vaults ?? []).map((r: Record<string, any>) => ({
    id: r.id,
    title: r.title,
    tagline: r.tagline ?? '',
    description: r.description ?? '',
    version: r.version ?? '1.0',
    noteCount: r.note_count ?? 0,
    plugins: r.plugins ?? [],
    tags: r.tags ?? [],
    filePath: r.file_path,
    updatedAt: r.updated_at,
  }));
}

async function requireVault(userId: string, vaultId: string): Promise<OwnedVault> {
  const v = (await ownedVaults(userId)).find((x) => x.id === vaultId);
  if (!v) throw new Error(`You do not own a vault with id ${vaultId}. Call list_vaults first.`);
  return v;
}

const cache = new Map<string, Notes>();

function demoNotes(v: OwnedVault): Notes {
  const notes: Notes = new Map();
  notes.set('Home.md', `# ${v.title}\n\n> ${v.tagline}\n\n${v.description}\n\n## Start here\n- [[Getting started]]\n- [[Templates/Daily note]]\n- [[About this vault]]\n`);
  notes.set('About this vault.md', `# About this vault\n\n- Version: ${v.version}\n- Plugins: ${v.plugins.join(', ') || 'none'}\n- Tags: ${v.tags.map((t) => `#${t}`).join(' ')}\n\nThis is demo content served by Vault Market in demo mode. Buy or upload a real vault to see its notes here.\n`);
  notes.set('Getting started.md', `# Getting started\n\n1. Unzip the vault into your Obsidian vaults folder.\n2. Open it in Obsidian and enable the plugins listed in [[About this vault]].\n3. Read [[Home]] and follow the links.\n`);
  notes.set('Templates/Daily note.md', `---\ntags: [daily]\n---\n# {{date}}\n\n## Focus\n- \n\n## Log\n- \n\n## Review\n- \n`);
  return notes;
}

/** Text files of a vault, keyed by path inside the vault (top-level zip folder stripped). */
async function loadNotes(v: OwnedVault): Promise<Notes> {
  const key = `${v.id}:${v.updatedAt}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let notes: Notes;
  if (IS_DEMO || !v.filePath) {
    notes = demoNotes(v);
  } else {
    const { data, error } = await adminClient().storage.from(STORAGE_BUCKETS.files).download(v.filePath);
    if (error || !data) throw new Error(error?.message ?? 'Could not download the vault archive.');
    const files = unzipSync(new Uint8Array(await data.arrayBuffer()), {
      filter: (f) => TEXT_EXT.test(f.name) && f.originalSize <= MAX_NOTE_BYTES && !/(^|\/)(\.obsidian|\.trash|__MACOSX|node_modules)\//.test(f.name) && !/(^|\/)\./.test(f.name),
    });
    const paths = Object.keys(files);
    const first = paths[0]?.split('/')[0];
    const stripRoot = !!first && paths.length > 0 && paths.every((p) => p.startsWith(`${first}/`));
    const decoder = new TextDecoder('utf-8');
    notes = new Map();
    for (const p of paths) {
      notes.set(stripRoot ? p.slice(first.length + 1) : p, decoder.decode(files[p]));
    }
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, notes);
  return notes;
}

/* ---------- MCP server ---------- */

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true };
}

/** One server per request, bound to the authenticated buyer. */
export function buildServer(userId: string): McpServer {
  const server = new McpServer({ name: 'vault-market', version: '1.0.0' });

  server.registerTool(
    'list_vaults',
    {
      title: 'List owned vaults',
      description: 'Lists the Obsidian vaults this user has bought or published on Vault Market, with their ids.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const vaults = await ownedVaults(userId);
        if (!vaults.length) return text('No vaults yet. Buy or grab a free vault on Vault Market first.');
        return text(vaults.map((v) => `- ${v.title} (id: ${v.id}, v${v.version}, ~${v.noteCount} notes)\n  ${v.tagline}`).join('\n'));
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
      inputSchema: z.object({
        vault_id: z.string().describe('Vault id from list_vaults'),
        folder: z.string().optional().describe('Folder prefix, e.g. "Templates"'),
      }),
    },
    async ({ vault_id, folder }) => {
      try {
        const notes = await loadNotes(await requireVault(userId, vault_id));
        const prefix = folder ? folder.replace(/^\/+|\/+$/g, '') + '/' : '';
        const paths = [...notes.keys()].filter((p) => p.startsWith(prefix)).sort();
        if (!paths.length) return text(prefix ? `No notes under ${prefix}` : 'This vault has no text notes.');
        return text(paths.slice(0, 500).join('\n') + (paths.length > 500 ? `\n… ${paths.length - 500} more` : ''));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'read_note',
    {
      title: 'Read a note',
      description: 'Returns the full text of one note by path.',
      inputSchema: z.object({
        vault_id: z.string(),
        path: z.string().describe('Path from list_notes, e.g. "Templates/Daily note.md"'),
      }),
    },
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
      inputSchema: z.object({
        vault_id: z.string(),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    },
    async ({ vault_id, query, limit }) => {
      try {
        const notes = await loadNotes(await requireVault(userId, vault_id));
        const q = query.toLowerCase();
        const hits: string[] = [];
        for (const [p, body] of notes) {
          const i = body.toLowerCase().indexOf(q);
          if (i === -1 && !p.toLowerCase().includes(q)) continue;
          const start = Math.max(0, i - 80);
          const snippet = i === -1 ? '' : body.slice(start, i + q.length + 80).replace(/\s+/g, ' ');
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
