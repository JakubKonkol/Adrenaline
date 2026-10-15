import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { movieHash } from './movie-hash';

const dir = mkdtempSync(join(tmpdir(), 'adr-hash-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Independent reference: whole buffer in memory, 32-bit halves with carries. */
function reference(buf: Buffer): string {
  let lo = buf.length >>> 0;
  let hi = Math.floor(buf.length / 2 ** 32) >>> 0;
  const add = (offset: number) => {
    for (let i = offset; i < offset + 65536; i += 8) {
      const l = lo + buf.readUInt32LE(i);
      lo = l >>> 0;
      hi = (hi + buf.readUInt32LE(i + 4) + (l > 0xffffffff ? 1 : 0)) >>> 0;
    }
  };
  add(0);
  add(buf.length - 65536);
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

function file(name: string, size: number, fill: (i: number) => number): { path: string; buf: Buffer } {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) buf[i] = fill(i);
  const path = join(dir, name);
  writeFileSync(path, buf);
  return { path, buf };
}

describe('movieHash (OpenSubtitles)', () => {
  it.each([
    ['patterned', 300_000, (i: number) => (i * 31 + 7) & 0xff],
    ['all ones (carries)', 200_000, () => 0xff],
    ['exactly 128 KiB', 131_072, (i: number) => i % 251],
    ['Zażółć gęślą jaźń.bin', 1_000_003, (i: number) => (i ^ (i >> 8)) & 0xff],
  ])('%s matches an independent implementation', async (name, size, fill) => {
    const { path, buf } = file(name, size, fill);
    const hash = await movieHash(path);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(hash).toBe(reference(buf));
  });

  it('has no hash for files under 128 KiB', async () => {
    expect(await movieHash(file('small', 131_071, () => 1).path)).toBeNull();
  });
});
