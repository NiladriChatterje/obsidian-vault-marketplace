import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ListVaultsParams, Vault } from '@/types';

export interface PagedVaults {
  /** Vaults known so far: every page fetched, whether or not it is still held in memory. */
  total: number;
  /** True once the backend reported no further page. */
  done: boolean;
  /** True while any page is in flight. */
  loading: boolean;
  /** The last fetch failure, cleared by the next successful fetch or a retry. */
  error: string | null;
  /** The vault at a list position, or undefined while its page is not in memory. */
  itemAt: (index: number) => Vault | undefined;
  /**
   * Report the list positions currently near the viewport. Pages they need are fetched (the next
   * page ahead of them too), and pages far away are dropped so memory stays bounded however far
   * the user has scrolled.
   */
  setViewport: (first: number, last: number) => void;
  /** Fetch again whatever last failed. */
  retry: () => void;
  /** Throw everything away and start from the first page. */
  refresh: () => void;
}

/** Pages kept on either side of the viewport before they are evicted. */
const KEEP_AROUND = 2;

interface Store {
  /** Loaded pages by index; evicted pages are simply absent. */
  pages: Map<number, Vault[]>;
  /** Length of every page fetched so far, kept through eviction so list positions stay stable. */
  lengths: number[];
  /** Cursor that fetches page i. Index 0 is undefined (the start); index n is set when page n-1 arrives. */
  cursors: (string | undefined)[];
  inFlight: Set<number>;
  done: boolean;
  error: string | null;
  failed: number | null;
}

function emptyStore(): Store {
  return { pages: new Map(), lengths: [], cursors: [undefined], inFlight: new Set(), done: false, error: null, failed: null };
}

/**
 * A windowed, cursor-paged view over `api.listVaults`. The store remembers the length and cursor
 * of every page it has seen, but holds the vaults of only the pages near the viewport, refetching
 * a dropped page by its cursor if the user scrolls back to it. Changing any filter resets the store;
 * a response for a superseded filter set is discarded.
 */
export function usePagedVaults(params: ListVaultsParams, pageSize = 24): PagedVaults {
  const store = useRef<Store>(emptyStore());
  const generation = useRef(0);
  const [, bump] = useState(0);
  const rerender = useCallback(() => bump((n) => n + 1), []);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const key = JSON.stringify(params);

  const fetchPage = useCallback(
    async (index: number) => {
      const s = store.current;
      const cursor = s.cursors[index];
      if (s.inFlight.has(index) || (index > 0 && cursor === undefined)) return;
      const gen = generation.current;
      s.inFlight.add(index);
      s.error = null;
      rerender();
      try {
        const page = await api.listVaults({ ...paramsRef.current, limit: pageSize, cursor });
        if (gen !== generation.current) return;
        s.pages.set(index, page.items);
        if (index === s.lengths.length) {
          // The frontier moved: record this page's length and where the next one starts.
          s.lengths.push(page.items.length);
          s.cursors[index + 1] = page.nextCursor ?? undefined;
          if (!page.nextCursor) s.done = true;
        }
        s.failed = null;
      } catch (e) {
        if (gen !== generation.current) return;
        s.error = e instanceof Error ? e.message : 'Something went wrong';
        s.failed = index;
      } finally {
        if (gen === generation.current) {
          s.inFlight.delete(index);
          rerender();
        }
      }
    },
    [pageSize, rerender]
  );

  const refresh = useCallback(() => {
    generation.current++;
    store.current = emptyStore();
    fetchPage(0);
  }, [fetchPage]);

  // `key` stands in for `params`, whose object identity changes every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [key, refresh]);

  const setViewport = useCallback(
    (first: number, last: number) => {
      const s = store.current;
      const frontier = s.lengths.length;
      const firstPage = Math.max(0, Math.floor(first / pageSize));
      const lastPage = Math.floor(Math.max(first, last) / pageSize);
      for (let p = firstPage; p <= lastPage + 1; p++) {
        if (p < frontier ? !s.pages.has(p) : p === frontier && !s.done && s.failed === null) fetchPage(p);
      }
      let evicted = false;
      for (const p of s.pages.keys()) {
        if (p < firstPage - KEEP_AROUND || p > lastPage + KEEP_AROUND) {
          s.pages.delete(p);
          evicted = true;
        }
      }
      if (evicted) rerender();
    },
    [fetchPage, pageSize, rerender]
  );

  const retry = useCallback(() => {
    const s = store.current;
    const target = s.failed ?? s.lengths.length;
    s.failed = null;
    fetchPage(target);
  }, [fetchPage]);

  const itemAt = useCallback(
    (index: number) => store.current.pages.get(Math.floor(index / pageSize))?.[index % pageSize],
    [pageSize]
  );

  const s = store.current;
  const total = s.lengths.reduce((n, l) => n + l, 0);
  return useMemo(
    () => ({ total, done: s.done, loading: s.inFlight.size > 0, error: s.error, itemAt, setViewport, retry, refresh }),
    // s.* are read fresh on every render; the memo just keeps the object stable between identical renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, s.done, s.inFlight.size, s.error, s.pages.size, itemAt, setViewport, retry, refresh]
  );
}
