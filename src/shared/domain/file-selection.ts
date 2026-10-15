import type { SearchTarget } from './search-target';

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
  pad: boolean;
}

export type FileKind = 'video' | 'subtitle' | 'executable' | 'archive' | 'other';

const VIDEO = /\.(mkv|mp4|avi|m4v|ts|webm|mov|wmv|mpg|mpeg)$/i;
const SUBTITLE = /\.(srt|ass|ssa|vtt|sub|idx)$/i;
/** Never selected by default (FR09); shown with a warning. */
const EXECUTABLE = /\.(exe|bat|cmd|msi|scr|lnk|ps1|vbs|js|jse|com|pif|cpl|hta|jar|wsf)$/i;
const ARCHIVE = /\.(zip|rar|7z|tar|gz|bz2|xz|iso|r\d{2})$/i;
const EXTRA =
  /(^|[\\/._\s-])(sample|trailer|extras?|featurettes?|behind[\s._-]the[\s._-]scenes|deleted[\s._-]scenes)([\\/._\s-]|$)/i;

export function fileKind(path: string): FileKind {
  if (EXECUTABLE.test(path)) return 'executable';
  if (ARCHIVE.test(path)) return 'archive';
  if (VIDEO.test(path)) return 'video';
  if (SUBTITLE.test(path)) return 'subtitle';
  return 'other';
}

export interface FileSelection {
  /** Indices to download (empty when the choice must be made by the user). */
  selected: number[];
  /** True when the user must confirm the choice (FR09). */
  ambiguous: boolean;
  /** Video files the user can choose from. */
  candidates: number[];
  /** Files that must never be pre-selected (executables, archives). */
  blocked: number[];
}

function episodeMatches(path: string, season: number, episode: number): boolean {
  const name = path.split(/[\\/]/).pop() ?? path;
  const m = name.match(/\bs(\d{1,2})[\s._-]?e(\d{1,3})\b/i) ?? name.match(/\b(\d{1,2})x(\d{2,3})\b/);
  return !!m && Number(m[1]) === season && Number(m[2]) === episode;
}

/**
 * Default file choice (FR09): for a film the largest video file that is not a sample/trailer/extra; for an episode
 * the video file matching SxxEyy. Executables and archives are never selected. `ambiguous` when ≥ 2 videos are
 * larger than half of the biggest one (film) or when no episode file matches.
 */
export function selectDefaultFiles(files: TorrentFile[], target: SearchTarget): FileSelection {
  const real = files.filter((f) => !f.pad);
  const blocked = real.filter((f) => ['executable', 'archive'].includes(fileKind(f.path))).map((f) => f.index);
  const videos = real.filter((f) => fileKind(f.path) === 'video');
  const main = videos.filter((f) => !EXTRA.test(f.path));
  const candidates = videos.map((f) => f.index);

  if (target.kind === 'episode') {
    const matching = main.filter((f) => episodeMatches(f.path, target.season, target.episode));
    if (matching.length === 1) return { selected: [matching[0]!.index], ambiguous: false, candidates, blocked };
    // A single-episode release without SxxEyy in the file name: its only main video.
    if (matching.length === 0 && main.length === 1 && !main[0]!.path.match(/\bs\d{1,2}e\d{1,3}\b/i)) {
      return { selected: [main[0]!.index], ambiguous: false, candidates, blocked };
    }
    const best = [...matching].sort((a, b) => b.size - a.size)[0];
    return { selected: best ? [best.index] : [], ambiguous: true, candidates, blocked };
  }

  const pool = main.length ? main : videos;
  const sorted = [...pool].sort((a, b) => b.size - a.size);
  const biggest = sorted[0];
  if (!biggest) return { selected: [], ambiguous: true, candidates, blocked };
  const competitors = sorted.filter((f) => f.size > biggest.size * 0.5);
  return { selected: [biggest.index], ambiguous: competitors.length >= 2, candidates, blocked };
}
