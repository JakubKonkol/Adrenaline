import { randomUUID } from 'node:crypto';
import { copyFile, link, lstat, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, parse, resolve } from 'node:path';
import { AppError } from '@shared/errors';
import { resolveInside } from './safe-path';

/** Check every existing ancestor, including junctions above the configured download folder. */
export async function subtitleVideoPath(base: string, relative: string): Promise<string> {
  const full = resolveInside(base, relative);
  let current = full;
  while (current !== parse(current).root) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (current === full && !stat.isFile())) throw new AppError('UNSAFE_TORRENT_PATH');
    current = dirname(current);
  }
  return full;
}

/** Exclusive creation prevents an existing sidecar (including a symlink) from being overwritten. */
export async function writeSubtitle(video: string, language: string, extension: string, text: string): Promise<string> {
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(language) || !/^\.(srt|ass|ssa|vtt|sub)$/.test(extension))
    throw new AppError('SUBS_BAD_FILE');
  const stem = video.slice(0, -extname(video).length);
  const temp = resolve(dirname(video), `.adrenaline-${randomUUID()}.tmp`);
  try {
    const file = await open(temp, 'wx');
    try {
      await file.writeFile(text, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    for (let number = 1; number <= 1000; number++) {
      const target = `${stem}.${language}${number === 1 ? '' : `.${number}`}${extension}`;
      try {
        try {
          await link(temp, target);
        } catch (error) {
          // exFAT/FAT do not support hard links. COPYFILE_EXCL still guarantees no clobber.
          if (!['ENOSYS', 'ENOTSUP', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
          await copyFile(temp, target, constants.COPYFILE_EXCL);
        }
        return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new AppError('PATH_CONFLICT');
  } finally {
    await rm(temp, { force: true });
  }
}
