import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, unwrap } from './bridge';

const KEY = ['library'] as const;

/** Finished downloads (D-80). Refreshed whenever a download changes state. */
export function useLibrary() {
  const qc = useQueryClient();
  useEffect(
    () =>
      api().events.on('downloads:changed', () => {
        void qc.invalidateQueries({ queryKey: KEY });
      }),
    [qc],
  );
  return useQuery({ queryKey: KEY, queryFn: () => unwrap(api().library.list()) });
}

export const playLibraryItem = (id: string) => unwrap(api().library.play({ id }));
export const showLibraryItem = (id: string) => unwrap(api().library.showInFolder({ id }));

export function useRemoveLibraryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; deleteFiles: boolean }) => unwrap(api().library.remove(input)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['downloads'] });
    },
  });
}
