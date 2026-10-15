import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { AddCustomSource, JackettStatus, Source } from '@shared/contracts/sources';
import type { ReleaseSession } from '@shared/contracts/releases';
import type { SearchTarget } from '@shared/domain/search-target';
import { api, unwrap } from './bridge';

/**
 * Release search for a target: reuses `sessionId` (back navigation) or starts a new search, then follows the
 * streamed `releases:update` events (partial results, NFR03).
 */
export function useReleaseSearch(target: SearchTarget | null, initialSessionId: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId);
  const [session, setSession] = useState<ReleaseSession | null>(null);
  const [error, setError] = useState<unknown>(null);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    const off = api().events.on('releases:update', (s) => {
      if (s.id === sessionId) setSession(s);
    });
    void unwrap(api().releases.session({ sessionId })).then((s) => {
      if (s) setSession((current) => current ?? s);
    });
    return off;
  }, [sessionId]);

  const start = (refresh: boolean) => {
    if (!target) return;
    setError(null);
    setSession(null);
    unwrap(api().releases.startSearch({ target, refresh })).then(
      (r) => setSessionId(r.sessionId),
      (e: unknown) => setError(e),
    );
  };

  useEffect(() => {
    if (!target || initialSessionId) return;
    const key = JSON.stringify(target);
    if (started.current === key) return; // StrictMode double effect
    started.current = key;
    start(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, initialSessionId]);

  return { session, sessionId, error, refresh: () => start(true) };
}

const SOURCES = ['sources'] as const;
const JACKETT = ['sources', 'jackett'] as const;

export function useSources() {
  return useQuery({ queryKey: SOURCES, queryFn: () => unwrap(api().sources.list()), staleTime: 10_000 });
}

export function useSetSourceEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => unwrap(api().sources.setEnabled(input)),
    onSuccess: (list) => qc.setQueryData<Source[]>(SOURCES, list),
    onSettled: () => void qc.invalidateQueries({ queryKey: SOURCES }),
  });
}

export function useTestSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api().sources.test({ id })),
    onSettled: () => void qc.invalidateQueries({ queryKey: SOURCES }),
  });
}

export function useAddCustomSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddCustomSource) => unwrap(api().sources.addCustom(input)),
    onSuccess: (list) => qc.setQueryData<Source[]>(SOURCES, list),
  });
}

export function useRemoveSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(api().sources.remove({ id })),
    onSuccess: (list) => qc.setQueryData<Source[]>(SOURCES, list),
  });
}

export function useJackettStatus() {
  const qc = useQueryClient();
  useEffect(() => api().events.on('jackett:status', (s) => qc.setQueryData<JackettStatus>(JACKETT, s)), [qc]);
  return useQuery({ queryKey: JACKETT, queryFn: () => unwrap(api().sources.jackettStatus()), staleTime: Infinity });
}

export function useRestartJackett() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api().sources.restartJackett()),
    onSuccess: (s) => qc.setQueryData<JackettStatus>(JACKETT, s),
  });
}
