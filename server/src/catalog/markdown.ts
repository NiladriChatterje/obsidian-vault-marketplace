/** Small, dependency-free helpers for turning an Obsidian .md file into note metadata. */

export interface ParsedNote {
  title: string;
  folder: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
}

/** Notes. Everything else a vault may hold (see file-policy.ts) is an attachment. */
export const MARKDOWN_EXT = /\.(md|canvas)$/i;

/** Very small YAML subset: `key: value`, `key: [a, b]`, and `- item` lists. Enough for Obsidian frontmatter. */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!m) return { data: {}, body: content };
  const data: Record<string, unknown> = {};
  let currentKey: string | null = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      const arr = Array.isArray(data[currentKey]) ? (data[currentKey] as unknown[]) : [];
      arr.push(scalar(listItem[1]));
      data[currentKey] = arr;
      continue;
    }
    const kv = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim();
    const value = kv[2].trim();
    currentKey = key;
    if (value === '') data[key] = [];
    else if (value.startsWith('[') && value.endsWith(']')) data[key] = value.slice(1, -1).split(',').map((v) => scalar(v.trim())).filter((v) => v !== '');
    else data[key] = scalar(value);
  }
  return { data, body: content.slice(m[0].length) };
}

function scalar(v: string): unknown {
  const s = v.replace(/^["']|["']$/g, '');
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

export function parseNote(path: string, content: string): ParsedNote {
  const { data, body } = parseFrontmatter(content);
  const filename = path.split('/').pop() ?? path;
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const h1 = /^#\s+(.+?)\s*$/m.exec(body)?.[1];
  const title = (typeof data.title === 'string' && data.title) || h1 || filename.replace(MARKDOWN_EXT, '');

  const tags = new Set<string>();
  const fmTags = Array.isArray(data.tags) ? data.tags : typeof data.tags === 'string' ? data.tags.split(/[,\s]+/) : [];
  for (const t of fmTags) if (typeof t === 'string' && t) tags.add(t.replace(/^#/, '').toLowerCase());
  for (const m of body.matchAll(/(^|[\s(])#([A-Za-z0-9_\-/]+)/g)) tags.add(m[2].toLowerCase());

  const links = new Set<string>();
  for (const m of body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) links.add(m[1].trim());

  return { title, folder, frontmatter: data, tags: [...tags].slice(0, 30), links: [...links].slice(0, 200) };
}

/** Strips a single shared top-level folder (zips of a vault folder usually have one). */
export function stripCommonRoot(paths: string[]): (p: string) => string {
  const first = paths[0]?.split('/')[0];
  const shared = !!first && paths.length > 0 && paths.every((p) => p.startsWith(`${first}/`));
  return shared ? (p) => p.slice(first.length + 1) : (p) => p;
}

export function isIgnoredPath(path: string): boolean {
  return /(^|\/)(\.trash|__MACOSX|node_modules|\.git)\//.test(path) || /(^|\/)\.DS_Store$/.test(path) || path.endsWith('/');
}
