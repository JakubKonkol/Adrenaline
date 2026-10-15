import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { OpenSubtitlesClient } from './opensubtitles-client';

const fixture = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/opensubtitles/${name}.json`, 'utf8')) as unknown;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup() {
  let session: string | null = null;
  const fetcher = vi.fn<typeof fetch>();
  const sleep = vi.fn(async () => {});
  const client = new OpenSubtitlesClient({
    apiKey: () => 'test-api-key',
    username: () => 'tester',
    password: () => 'password',
    userAgent: 'Adrenaline vtest',
    session: {
      get: () => session,
      set: (value) => {
        session = value;
      },
    },
    fetch: fetcher,
    sleep,
  });
  return { client, fetcher, sleep, stored: () => session };
}
describe('OpenSubtitles contract (synthetic official API fixtures)', () => {
  it('logs in once, routes to VIP host, sorts query and maps all subtitle files', async () => {
    const { client, fetcher, stored } = setup();
    fetcher.mockResolvedValueOnce(response({ ...(fixture('login') as object), base_url: 'vip-api.opensubtitles.com' }));
    fetcher.mockResolvedValueOnce(response(fixture('search')));
    const result = await client.search({
      parentTmdbId: 123,
      season: 1,
      episode: 2,
      languages: ['PL', 'en'],
      moviehash: 'ABC',
    });
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ fileId: 5001, moviehashMatch: true, language: 'pl' });
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      'https://vip-api.opensubtitles.com/api/v1/subtitles?episode_number=2&languages=en%2Cpl&moviehash=abc&parent_tmdb_id=123&season_number=1',
    );
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Api-Key': 'test-api-key',
      Authorization: 'Bearer test-jwt-token',
    });
    expect(stored()).toContain('vip-api.opensubtitles.com');
  });
  it('relogs once after 401, then returns SUBS_AUTH', async () => {
    const { client, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(response({}, 401));
    await expect(client.search({ languages: ['pl'] })).rejects.toMatchObject({ code: 'SUBS_AUTH' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('does not retry wrong login credentials', async () => {
    const { client, fetcher } = setup();
    fetcher.mockResolvedValue(response({}, 401));
    await expect(client.search({ languages: ['pl'] })).rejects.toMatchObject({ code: 'SUBS_AUTH' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retries GET on 503 with backoff but never repeats an ambiguous download POST', async () => {
    const { client, fetcher, sleep } = setup();
    fetcher
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(fixture('search')));
    await client.search({ languages: ['pl'] });
    expect(sleep).toHaveBeenCalledOnce();
    fetcher.mockRejectedValue(new Error('timeout'));
    await expect(client.downloadLink(5001)).rejects.toMatchObject({ code: 'SUBS_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('treats the last successful download as usable and keeps quota reset details on 406', async () => {
    const { client, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(response({ ...(fixture('download') as object), remaining: 0 }))
      .mockResolvedValueOnce(response({ reset_time_utc: '2030-01-01T00:00:00Z' }, 406));
    expect((await client.downloadLink(5001)).remaining).toBe(0);
    await expect(client.downloadLink(5002)).rejects.toMatchObject({
      code: 'SUBS_QUOTA',
      details: { resetAt: Date.parse('2030-01-01T00:00:00Z') },
    });
  });
  it('does not retry rate limits and honors Retry-After', async () => {
    const { client, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }));
    await expect(client.search({ languages: ['pl'] })).rejects.toMatchObject({ code: 'SUBS_QUOTA' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('blocks untrusted login hosts and credential redirects', async () => {
    const { client, fetcher, stored } = setup();
    fetcher.mockResolvedValueOnce(response({ token: 'test', base_url: '127.0.0.1' }));
    await expect(client.login()).rejects.toMatchObject({ code: 'SUBS_UNAVAILABLE' });
    expect(stored()).toBeNull();
    fetcher
      .mockResolvedValueOnce(response(fixture('login')))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://evil.invalid/steal' } }));
    await expect(client.search({ languages: ['pl'] })).rejects.toMatchObject({ code: 'SUBS_BAD_FILE' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('follows trusted GET redirects and downloads without API secrets', async () => {
    const { client, fetcher } = setup();
    fetcher
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://dl.opensubtitles.com/file.srt' } }),
      )
      .mockResolvedValueOnce(new Response('subtitle'));
    expect((await client.fetchFile('https://www.opensubtitles.com/download/test')).toString()).toBe('subtitle');
    expect(fetcher.mock.calls[1]?.[1]?.headers).not.toHaveProperty('Api-Key');
    await expect(client.fetchFile('https://127.0.0.1/private')).rejects.toMatchObject({ code: 'SUBS_BAD_FILE' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects invalid JSON and oversized files', async () => {
    const { client, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response('<html>bad</html>'));
    await expect(client.login()).rejects.toMatchObject({ code: 'SUBS_UNAVAILABLE' });
    fetcher.mockResolvedValueOnce(new Response(Buffer.alloc(5 * 1024 * 1024 + 1)));
    await expect(client.fetchFile('https://dl.opensubtitles.com/file')).rejects.toMatchObject({
      code: 'SUBS_BAD_FILE',
    });
  });
  it('does not restore a session when credentials change during login', async () => {
    const { client, fetcher, stored } = setup();
    let resolve!: (res: Response) => void;
    fetcher.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const pending = client.login();
    client.invalidate();
    resolve(response(fixture('login')));
    await expect(pending).rejects.toMatchObject({ code: 'SUBS_AUTH' });
    expect(stored()).toBeNull();
  });
});
