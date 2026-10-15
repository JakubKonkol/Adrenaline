import { randomBytes } from 'node:crypto';
import { mkdir, statfs, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppError } from '@shared/errors';

/** Free bytes available to the user on the volume of `dir` (nearest existing parent). */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await statfs(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

/** Free bytes for a folder that may not exist yet: measured on its nearest existing parent. */
export async function freeBytesNear(dir: string): Promise<number | null> {
  let current = dir;
  for (let i = 0; i < 64; i++) {
    const free = await freeBytes(current);
    if (free !== null) return free;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * FR07: the folder must exist (created if missing) and accept a write. Throws PATH_NOT_WRITABLE with the reason
 * otherwise. A probe file is written and removed.
 */
export async function checkWritable(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    const probe = join(dir, `.adrenaline-write-test-${randomBytes(4).toString('hex')}`);
    await writeFile(probe, 'ok');
    await unlink(probe);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new AppError('PATH_NOT_WRITABLE', code ?? 'not writable');
  }
}

/** Space needed for a download: size + 1% (etap 6.2). */
export function requiredSpace(sizeBytes: number): number {
  return Math.ceil(sizeBytes * 1.01);
}
