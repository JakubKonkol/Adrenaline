import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterEach, expect, it, vi } from 'vitest';
import { HashSubtitlesClient, napiHash, napiSubhash } from './hash-subtitles';
import { movieHash } from './opensubtitles/movie-hash';
import { validateSubtitle } from './opensubtitles/subtitle-file';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello\n';
function video(data = Buffer.alloc(131072, 1)) {
  const dir = mkdtempSync(join(tmpdir(), 'adr-hash-sub-'));
  dirs.push(dir);
  const path = join(dir, 'Film.2020.1080p.mkv');
  writeFileSync(path, data);
  return path;
}

it('hashes only the first 10 MiB and constructs the NapiProjekt verification hash', async () => {
  const data = Buffer.alloc(10 * 1024 * 1024 + 10, 7);
  const path = video(data);
  expect(await napiHash(path)).toBe(
    createHash('md5')
      .update(data.subarray(0, 10 * 1024 * 1024))
      .digest('hex'),
  );
  expect(napiSubhash('0123456789abcdef0123456789abcdef')).toBe('e2308');
});

it('gets bounded gzip subtitles from NapiProjekt without credentials', async () => {
  const path = video();
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(gzipSync(Buffer.from(srt))));
  const client = new HashSubtitlesClient({ fetch });
  const [result] = await client.search('napiprojekt', path);
  expect(result?.candidate).toMatchObject({ provider: 'napiprojekt', language: 'pl', moviehashMatch: true });
  expect(result?.data.toString()).toBe(srt);
  const input = fetch.mock.calls[0]![0];
  const url = new URL(input instanceof Request ? input.url : input.toString());
  expect(url.origin).toBe('https://napiprojekt.pl');
  expect(url.searchParams.get('f')).toBe(await napiHash(path));
  expect(url.searchParams.get('t')).toBe(napiSubhash(await napiHash(path)));
  expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
});

it('distinguishes not found, malformed payloads and HTTP failures', async () => {
  const path = video();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response('NPc0'))
    .mockResolvedValueOnce(new Response('<html>error</html>'))
    .mockResolvedValueOnce(new Response('bad', { status: 503 }));
  const client = new HashSubtitlesClient({ fetch });
  expect(await client.search('napiprojekt', path)).toEqual([]);
  await expect(client.search('napiprojekt', path)).rejects.toMatchObject({ code: 'SUBS_BAD_FILE' });
  await expect(client.search('napiprojekt', path)).rejects.toMatchObject({ code: 'SUBS_UNAVAILABLE' });
});

it('uses Napisy24 API credentials, file size and both hashes; parses the ZIP after the binary separator', async () => {
  const path = video();
  const data = Buffer.from(zipSync({ 'polskie.srt': Buffer.from(srt) }));
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(Buffer.concat([Buffer.from('OK-2|napisId:123|fps:24||'), data])));
  const client = new HashSubtitlesClient({ fetch, username: () => 'adrenaline', password: () => 'secret' });
  const [result] = await client.search('napisy24', path);
  expect(result?.candidate).toMatchObject({ provider: 'napisy24', id: 'napisy24:123' });
  expect(validateSubtitle(result!.data, result!.fileName, 'pl').text).toBe(srt);
  const body = fetch.mock.calls[0]![1]!.body as URLSearchParams;
  expect(body.get('ua')).toBe('adrenaline');
  expect(body.get('fs')).toBe('131072');
  expect(body.get('fh')).toBe((await movieHash(path))!.toUpperCase());
  expect(body.get('md')).toBe(await napiHash(path));
});

it('does not contact Napisy24 without credentials and recognizes authentication and negative replies', async () => {
  const path = video();
  const fetch = vi.fn<typeof globalThis.fetch>();
  await expect(new HashSubtitlesClient({ fetch }).search('napisy24', path)).rejects.toMatchObject({
    code: 'SUBS_NO_KEY',
  });
  expect(fetch).not.toHaveBeenCalled();
  const client = new HashSubtitlesClient({ fetch, username: () => 'agent', password: () => 'secret' });
  fetch.mockResolvedValueOnce(new Response('login error'));
  await expect(client.search('napisy24', path)).rejects.toMatchObject({ code: 'SUBS_AUTH' });
  for (const status of ['OK-0||', 'OK-1|imdb:123||', 'OK-3|napisId:123||']) {
    fetch.mockResolvedValueOnce(new Response(status));
    expect(await client.search('napisy24', path)).toEqual([]);
  }
});
