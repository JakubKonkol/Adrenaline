import { lstat } from 'node:fs/promises';
import path, { type PlatformPath } from 'node:path';
import { AppError } from '@shared/errors';

type PathImpl = PlatformPath;

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"|?*\u0000-\u001f]/;

/** Windows path length above which we warn (no LongPathsEnabled requirement). */
export const PATH_WARN_LENGTH = 240;

/** Checks one path segment for Windows rules (NFR06): no reserved names, invalid chars, trailing dot/space. */
export function isSafeSegment(segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false;
  if (INVALID_CHARS.test(segment)) return false;
  if (RESERVED.test(segment)) return false;
  if (/[. ]$/.test(segment)) return false;
  return true;
}

/**
 * Resolves `relPath` (from a torrent, separator `/` or `\`) inside `baseDir`. Rejects absolute paths, drive letters,
 * UNC, `..`, reserved names, invalid characters and trailing dots/spaces; the result must stay inside `baseDir`.
 */
export function resolveInside(baseDir: string, relPath: string, p: PathImpl = path): string {
  if (!relPath || relPath.length > 4096) throw new AppError('UNSAFE_TORRENT_PATH', 'empty path');
  if (/^[a-zA-Z]:/.test(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    throw new AppError('UNSAFE_TORRENT_PATH', 'absolute path');
  }
  const segments = relPath.split(/[\\/]+/).filter((s) => s !== '');
  if (segments.length === 0) throw new AppError('UNSAFE_TORRENT_PATH', 'empty path');
  for (const s of segments) {
    if (!isSafeSegment(s)) throw new AppError('UNSAFE_TORRENT_PATH', 'unsafe segment');
  }
  const base = p.resolve(baseDir);
  const full = p.resolve(base, ...segments);
  const rel = p.relative(base, full);
  if (!rel || rel.startsWith('..') || p.isAbsolute(rel)) throw new AppError('UNSAFE_TORRENT_PATH', 'outside base');
  return full;
}

const REPLACEMENTS: [RegExp, string][] = [
  [/\s*:\s*/g, ' - '],
  [/[<>|]/g, '-'],
  [/[/\\]/g, '-'],
  [/"/g, "'"],
  [/[?*]/g, ''],
  // eslint-disable-next-line no-control-regex
  [/[\u0000-\u001f]/g, ''],
];

/** Turns a title into a folder/file name valid on Windows ("Mission: Impossible" → "Mission - Impossible"). */
export function sanitizeFileName(name: string, maxLength = 120): string {
  let out = name.normalize('NFC');
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  out = out.replace(/\s+/g, ' ').trim();
  if (out.length > maxLength) out = out.slice(0, maxLength).trim();
  out = out.replace(/[. ]+$/, '');
  if (!out) return 'Adrenaline';
  if (RESERVED.test(out)) out = `_${out}`;
  return out;
}

export function isPathTooLong(fullPath: string): boolean {
  return fullPath.length > PATH_WARN_LENGTH;
}

/** True when `dir` itself is a symlink or junction (download folders must be real directories). */
export async function isLink(dir: string): Promise<boolean> {
  try {
    return (await lstat(dir)).isSymbolicLink();
  } catch {
    return false;
  }
}
