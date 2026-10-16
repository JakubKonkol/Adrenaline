import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from './api';

interface CacheEntry {
  data: unknown;
  savedAt: number;
}

/** Small in-memory cache: going back to a screen shows its data at once, then refreshes it. */
const cache = new Map<string, CacheEntry>();
const MAX_AGE_MS = 5 * 60_000;

function readCache<T>(key: string | null): T | undefined {
  if (key === null) return undefined;
  const hit = cache.get(key);
  return hit && Date.now() - hit.savedAt < MAX_AGE_MS ? (hit.data as T) : undefined;
}

export interface Query<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

interface State<T> {
  key: string | null;
  data: T | undefined;
  error: ApiError | null;
}

/**
 * Loads `key` with `fetcher`; `pollMs` refreshes it while the screen is open. A null key skips loading. The latest
 * fetcher is used without restarting the poll, so callers can pass inline functions.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, pollMs?: number): Query<T> {
  const [state, setState] = useState<State<T>>(() => ({ key, data: readCache<T>(key), error: null }));
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  });
  // A new key starts from its cached value (React's "adjust state while rendering" pattern).
  let current = state;
  if (state.key !== key) {
    current = { key, data: readCache<T>(key), error: null };
    setState(current);
  }

  useEffect(() => {
    if (key === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      fetcherRef.current().then(
        (value) => {
          if (!alive) return;
          cache.set(key, { data: value, savedAt: Date.now() });
          setState({ key, data: value, error: null });
          if (pollMs) timer = setTimeout(load, pollMs);
        },
        (err: unknown) => {
          if (!alive) return;
          setState((s) => ({ ...s, key, error: err instanceof ApiError ? err : new ApiError('INTERNAL', 0) }));
          if (pollMs) timer = setTimeout(load, Math.max(pollMs, 5_000));
        },
      );
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [key, pollMs, nonce]);

  return {
    data: current.data,
    error: current.error,
    loading: key !== null && current.data === undefined && current.error === null,
    reload: () => {
      setState((s) => ({ ...s, error: null }));
      setNonce((n) => n + 1);
    },
  };
}

export function invalidate(prefix: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}

export function clearCache(): void {
  cache.clear();
}

/** Value that settles `ms` after the last change (search as you type). */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
