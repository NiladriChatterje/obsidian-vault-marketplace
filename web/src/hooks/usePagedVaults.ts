import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ListVaultsParams, Vault } from '@/types';

export interface PagedVaults {
  items: Vault[];
  /** True while any page is in flight, including the first. */
  loading: boolean;
  error: string | null;
  /** True once a page came back short, meaning there is nothing left to fetch. */
  done: boolean;
  /** Fetch the next page. A no-op while one is already loading or when the list is complete. */
  loadMore: () => void;
  /** Throw everything away and fetch the first page again. */
  refresh: () => void;
}

/**
 * Pages through `api.listVaults` a slice at a time, appending as the caller asks for more. Changing
 * any filter clears the list and starts over from the first page; a response that arrives after the
 * filters moved on is dropped rather than spliced into the wrong list.
 */
export function usePagedVaults(params: ListVaultsParams, pageSize = 24): PagedVaults {
  const [items, setItems] = useState<Vault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const runId = useRef(0);
  const inFlight = useRef(false);
  const count = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const key = JSON.stringify(params);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++runId.current;
      inFlight.current = true;
      setLoading(true);
      setError(null);
      try {
        const page = await api.listVaults({ ...paramsRef.current, limit: pageSize, offset });
        if (id !== runId.current) return;
        setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
        count.current = offset + page.length;
        setDone(page.length < pageSize);
      } catch (e) {
        if (id === runId.current) setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        if (id === runId.current) {
          inFlight.current = false;
          setLoading(false);
        }
      }
    },
    [pageSize]
  );

  const refresh = useCallback(() => {
    count.current = 0;
    setItems([]);
    setDone(false);
    fetchPage(0);
  }, [fetchPage]);

  // `key` stands in for `params`, whose object identity changes every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [key, refresh]);

  const loadMore = useCallback(() => {
    if (inFlight.current || done) return;
    fetchPage(count.current);
  }, [done, fetchPage]);

  return { items, loading, error, done, loadMore, refresh };
}
