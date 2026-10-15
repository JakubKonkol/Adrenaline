import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic-write';
import { checkWritable, freeBytes, requiredSpace } from './disk-space';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'adr-fs-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('checkWritable', () => {
  it('creates a missing folder (with Polish characters) and leaves no probe', async () => {
    const dir = join(tmp(), 'Filmy ąęść', 'Adrenaline');
    await checkWritable(dir);
    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('reports PATH_NOT_WRITABLE when the folder cannot be created', async () => {
    const base = tmp();
    const file = join(base, 'not-a-dir');
    writeFileSync(file, 'x');
    await expect(checkWritable(join(file, 'sub'))).rejects.toMatchObject({ code: 'PATH_NOT_WRITABLE' });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports a read-only folder', async () => {
    const dir = tmp();
    chmodSync(dir, 0o500);
    await expect(checkWritable(dir)).rejects.toMatchObject({ code: 'PATH_NOT_WRITABLE' });
    chmodSync(dir, 0o700);
  });
});

describe('freeBytes / requiredSpace', () => {
  it('returns a number for an existing folder', async () => {
    expect(await freeBytes(tmp())).toBeGreaterThan(0);
  });

  it('adds 1% to the size', () => {
    expect(requiredSpace(1000)).toBe(1010);
  });
});

describe('writeFileAtomic', () => {
  it('writes the file and leaves no temp files', async () => {
    const dir = tmp();
    const target = join(dir, 'Film.pl.srt');
    await writeFileAtomic(target, 'napisy');
    expect(readFileSync(target, 'utf8')).toBe('napisy');
    expect(readdirSync(dir)).toEqual(['Film.pl.srt']);
  });

  it('refuses to overwrite unless asked', async () => {
    const dir = tmp();
    const target = join(dir, 'a.txt');
    writeFileSync(target, 'old');
    await expect(writeFileAtomic(target, 'new')).rejects.toMatchObject({ code: 'PATH_CONFLICT' });
    await writeFileAtomic(target, 'new', { overwrite: true });
    expect(readFileSync(target, 'utf8')).toBe('new');
  });
});
