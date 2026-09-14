/**
 * Opaque paging cursors for the catalog list. A cursor names the row a page ended on: the values
 * of the sort keys it was ordered by, then its id as the tie-break. Clients pass it back verbatim;
 * nothing in it is trusted until `decodeCursor` has checked the shape.
 */
export interface Cursor {
  values: (number | string)[];
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.values, c.id])).toString('base64url');
}

/** Returns null for anything that is not a cursor this module produced. */
export function decodeCursor(raw: string | undefined, expectedValues: number): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
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
