import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { EngineStatus } from '@shared/contracts/app';
import { api, unwrap } from './bridge';

const KEY = ['app', 'engineStatus'] as const;

/** Engine process state (running / restarting / crashed…), kept live by the `engine:status` event. */
export function useEngineStatus() {
  const qc = useQueryClient();
  useEffect(() => api().events.on('engine:status', (s) => qc.setQueryData<EngineStatus>(KEY, s)), [qc]);
  return useQuery({ queryKey: KEY, queryFn: () => unwrap(api().app.engineStatus()), staleTime: Infinity });
}

export function useRestartEngine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api().app.restartEngine()),
    onSuccess: (s) => qc.setQueryData<EngineStatus>(KEY, s),
  });
}
