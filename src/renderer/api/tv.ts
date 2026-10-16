import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { TvDeployRequest, TvDeployState, TvServerStatus, TvToolchain } from '@shared/contracts/tv';
import { api, unwrap } from './bridge';

const STATUS = ['tv', 'status'] as const;
const DEPLOY = ['tv', 'deploy'] as const;
const TOOLS = ['tv', 'toolchain'] as const;

/** TV server status, kept live by the `tv:status` event (pairing requests, devices, playback). */
export function useTvStatus() {
  const qc = useQueryClient();
  useEffect(() => api().events.on('tv:status', (s) => qc.setQueryData<TvServerStatus>(STATUS, s)), [qc]);
  return useQuery({ queryKey: STATUS, queryFn: () => unwrap(api().tv.status()), staleTime: Infinity });
}

function useStatusAction<T>(fn: (input: T) => Promise<TvServerStatus>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: (s) => qc.setQueryData(STATUS, s) });
}

export const useApprovePairing = () => useStatusAction((id: string) => unwrap(api().tv.approve({ id })));
export const useDenyPairing = () => useStatusAction((id: string) => unwrap(api().tv.deny({ id })));
export const useRevokeDevice = () => useStatusAction((deviceId: string) => unwrap(api().tv.revoke({ deviceId })));

export function useToolchain() {
  return useQuery({ queryKey: TOOLS, queryFn: () => unwrap(api().tv.toolchain()) });
}

export function useChooseTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tool: 'adb' | 'tizen') => unwrap(api().tv.chooseTool({ tool })),
    onSuccess: (t) => qc.setQueryData<TvToolchain>(TOOLS, t),
  });
}

/** Deploy to TV progress (`tv:deploy` events). */
export function useDeployState() {
  const qc = useQueryClient();
  useEffect(() => api().events.on('tv:deploy', (s) => qc.setQueryData<TvDeployState | null>(DEPLOY, s)), [qc]);
  return useQuery({ queryKey: DEPLOY, queryFn: () => unwrap(api().tv.deployState()), staleTime: Infinity });
}

export function useStartDeploy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (request: TvDeployRequest) => unwrap(api().tv.deploy(request)),
    onSuccess: (s) => qc.setQueryData(DEPLOY, s),
  });
}

export const cancelDeploy = () => unwrap(api().tv.deployCancel());
