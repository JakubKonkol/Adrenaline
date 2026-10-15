import { useMutation, useQuery } from '@tanstack/react-query';
import type { CatalogSelection, MediaType } from '@shared/contracts/catalog';
import { api, unwrap } from './bridge';

export function useCatalogSearch(query: string, type: MediaType | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['catalog', 'search', query, type],
    queryFn: () => unwrap(api().catalog.search({ query, ...(type ? { type } : {}) })),
    enabled: enabled && query.trim().length > 0,
    staleTime: 15 * 60_000,
    retry: false,
  });
}
export function useTitle(type: MediaType, tmdbId: number, enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'details', type, tmdbId],
    queryFn: () => unwrap(api().catalog.details({ type, tmdbId })),
    enabled,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
}
export function useSeason(tmdbId: number, season: number, enabled = true) {
  return useQuery({
    queryKey: ['catalog', 'season', tmdbId, season],
    queryFn: () => unwrap(api().catalog.season({ tmdbId, season })),
    enabled,
    staleTime: 24 * 60 * 60_000,
    retry: false,
  });
}
export function useCatalogSelection() {
  return useMutation({ mutationFn: (input: CatalogSelection) => unwrap(api().catalog.select(input)) });
}
export function useTestTmdb() {
  return useMutation({ mutationFn: () => unwrap(api().settings.testTmdb()) });
}
