import { randomBytes } from 'node:crypto';
import { access, open, rename, rm } from 'node:fs/promises';
import { AppError } from '@shared/errors';

/**
 * Writes `data` to `target` atomically: `<target>.<rand>.tmp` → fsync → rename. Refuses to replace an existing file
 * unless `overwrite` is set (BR07: no silent overwrite).
 */
export async function writeFileAtomic(
  target: string,
  data: string | Uint8Array,
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  if (!opts.overwrite) {
    const exists = await access(target).then(
      () => true,
      () => false,
    );
    if (exists) throw new AppError('PATH_CONFLICT', 'file exists');
  }
  const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
  const fh = await open(tmp, 'wx');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
