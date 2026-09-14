/**
 * Opaque paging cursors for the local backends (Supabase and demo). Same shape as the server's:
 * the sort-key values of the row a page ended on, then its id as the tie-break. Nothing decoded
 * here is trusted until the shape has been checked, since Supabase filters are built from it.
 */
export interface Cursor {
  values: (number | string)[];
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify([c.values, c.id])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns null for anything that is not a cursor this module produced. */
export function decodeCursor(raw: string | undefined, expectedValues: number): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/')));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [values, id] = parsed;
    if (typeof id !== 'string' || !/^[\w.-]{1,128}$/.test(id)) return null;
    if (!Array.isArray(values) || values.length !== expectedValues) return null;
    for (const v of values) {
      if (typeof v === 'number' ? !Number.isFinite(v) : typeof v !== 'string' || v.length > 64) return null;
    }
    return { values, id };
  } catch {
    return null;
  }
}
