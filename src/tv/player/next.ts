import type { TvLibraryItem } from '@shared/contracts/tv';

/** The episode after `itemId` in the library (same show, next season/episode that is on the PC), or null. */
export function nextEpisode(items: TvLibraryItem[], itemId: string): TvLibraryItem | null {
  const current = items.find((i) => i.id === itemId);
  if (!current || current.kind !== 'episode') return null;
  const order = (i: TvLibraryItem) => (i.season ?? 0) * 10_000 + (i.episode ?? 0);
  return (
    items
      .filter((i) => i.kind === 'episode' && i.tmdbId === current.tmdbId && i.available && order(i) > order(current))
      .sort((a, b) => order(a) - order(b))[0] ?? null
  );
}

export function episodeLabel(item: TvLibraryItem): string {
  const code = `S${String(item.season ?? 0).padStart(2, '0')}E${String(item.episode ?? 0).padStart(2, '0')}`;
  return item.episodeTitle ? `${code} · ${item.episodeTitle}` : code;
}
