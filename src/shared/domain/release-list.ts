import type { Release } from '../contracts/releases';
import { compareReleases, type ReleaseSort } from './match';

export const RESOLUTION_FILTERS = ['all', '2160p', '1080p', '720p', 'other'] as const;
export type ResolutionFilter = (typeof RESOLUTION_FILTERS)[number];

export function filterReleases(
  releases: Release[],
  resolution: ResolutionFilter,
  sort: ReleaseSort,
  source = 'all',
  codec = 'all',
): Release[] {
  return releases
    .filter((r) => {
      const quality =
        resolution === 'all' ||
        (resolution === 'other'
          ? !['2160p', '1080p', '720p'].includes(r.parsed.resolution ?? '')
          : r.parsed.resolution === resolution);
      return (
        quality && (source === 'all' || r.parsed.source === source) && (codec === 'all' || r.parsed.codec === codec)
      );
    })
    .sort((a, b) =>
      compareReleases({ ...a, seeders: a.seeders?.value ?? null }, { ...b, seeders: b.seeders?.value ?? null }, sort),
    );
}
