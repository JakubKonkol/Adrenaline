import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { UpdaterStatus } from '@shared/contracts/app';
import { api, unwrap } from './bridge';

const KEY = ['app', 'updaterStatus'] as const;

/** Current updater state, kept live by the `updater:status` event. */
export function useUpdaterStatus() {
  const qc = useQueryClient();
  useEffect(() => api().events.on('updater:status', (s) => qc.setQueryData<UpdaterStatus>(KEY, s)), [qc]);
  return useQuery({ queryKey: KEY, queryFn: () => unwrap(api().app.updaterStatus()), staleTime: Infinity });
}

export function useCheckForUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api().app.checkForUpdates()),
    onSuccess: (s) => qc.setQueryData<UpdaterStatus>(KEY, s),
  });
}

export function useInstallUpdate() {
  return useMutation({ mutationFn: () => unwrap(api().app.installUpdate()) });
}

export function useAppVersion() {
  return useQuery({ queryKey: ['app', 'version'], queryFn: () => unwrap(api().app.version()), staleTime: Infinity });
}
