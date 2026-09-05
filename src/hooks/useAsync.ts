import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setData: (updater: (prev: T | null) => T | null) => void;
}

/** Minimal data-fetching hook; re-runs when `deps` change and exposes a manual refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const runId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++runId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === runId.current) setDataState(result);
    } catch (e) {
      if (id === runId.current) setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      if (id === runId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((updater: (prev: T | null) => T | null) => {
    setDataState((prev) => updater(prev));
  }, []);

  return { data, loading, error, refresh, setData };
}
