import path, { type PlatformPath } from 'node:path';
import type { SearchTarget } from '@shared/domain/search-target';
import { sanitizeFileName } from './safe-path';

/**
 * Job folder (D-75): `<base>/<Title (year)>/<release name>` for a film,
 * `<base>/<Series>/Season NN/<release name>` for an episode. Every part is a valid Windows name.
 */
export function jobFolder(baseDir: string, target: SearchTarget, releaseName: string, p: PlatformPath = path): string {
  const release = sanitizeFileName(releaseName, 100);
  if (target.kind === 'movie') {
    const title = sanitizeFileName(target.year ? `${target.title} (${target.year})` : target.title, 80);
    return p.join(baseDir, title, release);
  }
  const series = sanitizeFileName(target.title, 80);
  return p.join(baseDir, series, `Season ${String(target.season).padStart(2, '0')}`, release);
}

/** "Name (2)", "Name (3)"… for a folder that already exists (BR07: no silent overwrite). */
export function numberedVariant(folder: string, n: number, p: PlatformPath = path): string {
  return p.join(p.dirname(folder), `${p.basename(folder)} (${n})`);
}
