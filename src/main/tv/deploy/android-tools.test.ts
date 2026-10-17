import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { PLATFORM_TOOLS, prepareAutomaticAdb } from './android-tools';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('automatic adb (official platform-tools)', () => {
  it('downloads the pinned archive from Google and refuses anything else', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adr-adb-'));
    dirs.push(dir);
    const urls: string[] = [];
    const fake = zipSync({ 'platform-tools/adb.exe': new Uint8Array([1, 2, 3]) });
    const download = ((url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(fake));
    }) as unknown as typeof fetch;
    await expect(prepareAutomaticAdb(dir, new AbortController().signal, download)).rejects.toMatchObject({
      code: 'DEPLOY_PACKAGE_MISSING',
    });
    expect(urls).toEqual([`https://dl.google.com/android/repository/${PLATFORM_TOOLS.file}`]);
    const failing = (() => Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch;
    await expect(prepareAutomaticAdb(dir, new AbortController().signal, failing)).rejects.toMatchObject({
      code: 'DEPLOY_TOOL_MISSING',
    });
  });
});
