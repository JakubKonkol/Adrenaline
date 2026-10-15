import type { ParsedRelease, Resolution, VideoSource } from './release-parser';
import type { SearchTarget } from './search-target';

export const MATCH_WARNINGS = [
  'year_mismatch',
  'other_episode',
  'other_season',
  'season_pack',
  'no_episode_info',
  'series_release',
  'cam',
  'title_mismatch',
] as const;
export type MatchWarning = (typeof MATCH_WARNINGS)[number];

export interface MatchResult {
  score: number;
  warnings: MatchWarning[];
}

export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(parsed: string, target: SearchTarget): number {
  const p = normalizeTitle(parsed);
  if (!p) return 0;
  let best = 0;
  for (const candidate of [target.originalTitle, target.title]) {
    const t = normalizeTitle(candidate);
    if (!t) continue;
    if (p === t) return 50;
    const pt = p.split(' ');
    const tt = t.split(' ');
    const common = tt.filter((w) => pt.includes(w)).length;
    const ratio = common / Math.max(tt.length, pt.length);
    best = Math.max(best, Math.round(ratio * 40));
  }
  return best;
}

/** 0–100 match of a release to the chosen title/episode, with warnings shown next to the release (FR02). */
export function matchRelease(parsed: ParsedRelease, target: SearchTarget): MatchResult {
  const warnings: MatchWarning[] = [];
  let score = titleScore(parsed.title, target);
  if (score < 25) warnings.push('title_mismatch');

  if (target.kind === 'movie') {
    if (parsed.episode !== null || parsed.isSeasonPack) {
      warnings.push('series_release');
      score -= 30;
    }
    if (parsed.year === null || target.year === null) score += 10;
    else if (parsed.year === target.year) score += 30;
    else if (Math.abs(parsed.year - target.year) === 1) score += 15;
    else warnings.push('year_mismatch');
  } else {
    if (parsed.season === target.season && parsed.episode === target.episode) score += 40;
    else if (parsed.isSeasonPack && (parsed.season === target.season || parsed.season === null)) {
      score += 15;
      warnings.push('season_pack');
    } else if (parsed.season === null && parsed.episode === null) {
      score += 5;
      warnings.push('no_episode_info');
    } else if (parsed.season !== target.season) warnings.push('other_season');
    else warnings.push('other_episode');
  }

  if (parsed.source === 'CAM' || parsed.source === 'TS') {
    warnings.push('cam');
    score -= 30;
  }
  return { score: Math.max(0, Math.min(100, score)), warnings };
}

const RESOLUTION_PREF: Record<Resolution, number> = { '1080p': 5, '2160p': 4, '720p': 3, '576p': 2, '480p': 1 };
const SOURCE_PREF: Record<VideoSource, number> = {
  Remux: 6,
  BluRay: 6,
  'WEB-DL': 5,
  WEBRip: 4,
  HDTV: 3,
  DVDRip: 2,
  TS: 0,
  CAM: 0,
};

/** Preferred quality (default: 1080p, good source) as a single number for sorting. */
export function qualityScore(parsed: ParsedRelease): number {
  return (
    (parsed.resolution ? RESOLUTION_PREF[parsed.resolution] : 0) * 10 + (parsed.source ? SOURCE_PREF[parsed.source] : 0)
  );
}

export type ReleaseSort = 'match' | 'size' | 'seeders';

export interface Rankable {
  match: MatchResult;
  parsed: ParsedRelease;
  size: number | null;
  seeders: number | null;
}

/**
 * Sort order (etap 5.4): match (in 10-point bands) → preferred quality → seeders. "size" and "seeders" are the
 * user's explicit choices (FR06); unknown values go last.
 */
export function compareReleases(a: Rankable, b: Rankable, sort: ReleaseSort = 'match'): number {
  const desc = (x: number | null, y: number | null) => (y ?? -1) - (x ?? -1);
  if (sort === 'size') return desc(a.size, b.size) || desc(a.seeders, b.seeders);
  if (sort === 'seeders')
    return desc(a.seeders, b.seeders) || Math.floor(b.match.score / 10) - Math.floor(a.match.score / 10);
  return (
    Math.floor(b.match.score / 10) - Math.floor(a.match.score / 10) ||
    qualityScore(b.parsed) - qualityScore(a.parsed) ||
    desc(a.seeders, b.seeders)
  );
}
