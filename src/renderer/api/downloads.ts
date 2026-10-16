import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import type { DownloadJob, DownloadOptions, JobProgress } from '@shared/contracts/downloads';
import type { LanguageCode } from '@shared/domain/languages';
import { api, unwrap } from './bridge';

const LIST = ['downloads'] as const;

/**
 * Live progress, kept outside React Query: every 500 ms only the rows whose job changed re-render (NFR01/NFR02).
 */
const progress = new Map<string, JobProgress>();
const listeners = new Map<string, Set<() => void>>();
let wired = false;

function wireProgress() {
  if (wired) return;
  wired = true;
  const apply = (jobs: JobProgress[]) => {
    for (const p of jobs) {
      progress.set(p.jobId, p);
      for (const l of listeners.get(p.jobId) ?? []) l();
    }
  };
  api().events.on('downloads:progress', (e) => apply(e.jobs));
  void unwrap(api().downloads.progress()).then(apply, () => undefined);
}

export function useJobProgress(jobId: string): JobProgress | undefined {
  wireProgress();
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(jobId);
      if (!set) listeners.set(jobId, (set = new Set()));
      set.add(cb);
      return () => void set.delete(cb);
    },
    () => progress.get(jobId),
  );
}

/** Job list kept up to date by `downloads:changed`. */
export function useDownloads() {
  const qc = useQueryClient();
  useEffect(
    () =>
      api().events.on('downloads:changed', (job) => {
        qc.setQueryData<DownloadJob[]>(LIST, (list) => {
          if (!list) return list;
          if (job.state === 'removed') return list.filter((j) => j.id !== job.id);
          const i = list.findIndex((j) => j.id === job.id);
          return i < 0 ? [...list, job] : list.map((j) => (j.id === job.id ? job : j));
        });
        qc.setQueryData<DownloadJob>(['downloads', job.id], job);
      }),
    [qc],
  );
  return useQuery({ queryKey: LIST, queryFn: () => unwrap(api().downloads.list()), staleTime: Infinity });
}

export function useDownload(jobId: string) {
  useDownloads();
  return useQuery({
    queryKey: ['downloads', jobId],
    queryFn: () => unwrap(api().downloads.get({ jobId })),
    staleTime: Infinity,
    retry: false,
  });
}

function useJobAction<T>(fn: (input: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => void qc.invalidateQueries({ queryKey: LIST }) });
}

export const usePause = () => useJobAction((jobId: string) => unwrap(api().downloads.pause({ jobId })));
export const useResume = () => useJobAction((jobId: string) => unwrap(api().downloads.resume({ jobId })));
export const useRecheck = () => useJobAction((jobId: string) => unwrap(api().downloads.recheck({ jobId })));
export const useRemove = () =>
  useJobAction((input: { jobId: string; deleteFiles: boolean }) => unwrap(api().downloads.remove(input)));
export const useSelectFiles = () =>
  useJobAction((input: { jobId: string; indices: number[] }) => unwrap(api().downloads.selectFiles(input)));
/** Turns subtitles on (a language), off (null, D-78: "Skip subtitles") or changes them for one download. */
export const useSetSubtitles = () =>
  useJobAction((input: { jobId: string; language: LanguageCode | null; fallback: LanguageCode | null }) =>
    unwrap(api().subtitles.language(input)),
  );
export const openJobFolder = (jobId: string) => unwrap(api().downloads.openFolder({ jobId }));

export function usePreflight(ref: { sessionId: string; releaseId: string } | null, options: Partial<DownloadOptions>) {
  return useQuery({
    queryKey: ['downloads', 'preflight', ref, options.saveDir ?? null, options.renameOnConflict ?? false],
    queryFn: () => unwrap(api().downloads.preflight({ ref: ref!, options })),
    enabled: ref !== null,
    retry: false,
    staleTime: 0,
  });
}

export function useCreateDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ref: { sessionId: string; releaseId: string }; options: DownloadOptions }) =>
      unwrap(api().downloads.create(input)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: LIST }),
  });
}
