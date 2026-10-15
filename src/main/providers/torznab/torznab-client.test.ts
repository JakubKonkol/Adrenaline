import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SearchTarget } from '@shared/domain/search-target';
import {
  buildQueries,
  isAllowedDownloadUrl,
  isValidEndpoint,
  parseCaps,
  TorznabClient,
  type TorznabSource,
} from './torznab-client';

const FIX = join(import.meta.dirname, '../../../../tests/fixtures/torznab');
const fixture = (name: string) => readFileSync(join(FIX, name));

const source: TorznabSource = {
  id: 'jackett:example',
  name: 'Example',
  endpoint: 'http://127.0.0.1:9117/api/v2.0/indexers/example/results/torznab/api',
  apiKey: () => 'secret-key',
};

function client(body: Buffer | string, init: ResponseInit = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body, { status: 200, ...init }));
  return { c: new TorznabClient({ fetch, now: () => 42 }), fetch };
}

describe('Torznab contract (synthetic fixtures)', () => {
  it('parses caps', async () => {
    const { c, fetch } = client(fixture('caps.xml'));
    const caps = await c.caps(source);
    expect(caps.movieSearch).toEqual({ available: true, params: ['q', 'imdbid'] });
    expect(caps.tvSearch.params).toEqual(['q', 'season', 'ep']);
    expect(caps.categories).toEqual([2000, 2040, 2045, 5000]);
    const url = new URL(fetch.mock.calls[0]![0]);
    expect(url.searchParams.get('t')).toBe('caps');
    expect(url.searchParams.get('apikey')).toBe('secret-key');
  });

  it('parses results; missing fields are null, not 0', async () => {
    const { c } = client(fixture('results.xml'));
    const hits = await c.search(source, { t: 'movie', imdbid: 'tt0063350' });
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      sourceId: 'jackett:example',
      sourceName: 'Example',
      guid: 'https://indexer.example/torrent/1',
      title: 'Night of the Living Dead (1968) 1080p BRRip x264 -EXAMPLE',
      size: 1610612736,
      publishedAt: Date.UTC(2026, 9, 15, 10),
      seeders: 120,
      peers: 135,
      infoHash: '0123456789abcdef0123456789abcdef01234567',
      magnet: 'magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=Night',
      link: 'http://127.0.0.1:9117/dl/example/?jackett_apikey=abc&path=xyz&file=Night',
      imdbId: 'tt0063350',
      observedAt: 42,
    });
    expect(hits[1]).toMatchObject({ size: null, seeders: null, peers: null, link: null, imdbId: 'tt0100258' });
    expect(hits[1]!.magnet).toMatch(/^magnet:\?xt=urn:btih:89abcdef/);
  });

  it('returns an empty list for an empty channel', async () => {
    await expect(client(fixture('empty.xml')).c.search(source, { t: 'search', q: 'x' })).resolves.toEqual([]);
  });

  it('maps Torznab errors: bad API key → SOURCE_AUTH, other → SOURCE_BAD_RESPONSE', async () => {
    await expect(client(fixture('error-apikey.xml')).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_AUTH',
    });
    await expect(client(fixture('error-other.xml')).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_BAD_RESPONSE',
    });
  });

  it('rejects HTML instead of XML and HTTP auth errors', async () => {
    await expect(client(fixture('html.html')).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_BAD_RESPONSE',
    });
    await expect(client('', { status: 401 }).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_AUTH',
    });
    await expect(client('', { status: 503 }).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
  });

  it('rejects responses over 5 MB, also without Content-Length', async () => {
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(huge, { status: 200 }));
    await expect(new TorznabClient({ fetch }).search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_BAD_RESPONSE',
    });
  });

  it('rejects documents with a DTD (XXE, billion laughs) and expands no custom entities', async () => {
    await expect(client(fixture('entities.xml')).c.search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_BAD_RESPONSE',
    });
    const xml = '<rss><channel><item><title>A &amp; B &#xE9; &custom; 2020</title></item></channel></rss>';
    const hits = await client(xml).c.search(source, { t: 'search' });
    expect(hits[0]!.title).toBe('A & B é &custom; 2020');
  });

  it('times out with SOURCE_TIMEOUT', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
          ),
      );
    await expect(new TorznabClient({ fetch, timeoutMs: 20 }).search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_TIMEOUT',
    });
  });

  it('maps network failures to SOURCE_UNAVAILABLE', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(new TorznabClient({ fetch }).search(source, { t: 'search' })).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
    });
  });
});

describe('endpoint and link rules (SSRF)', () => {
  it('accepts only http(s) endpoints without credentials', () => {
    expect(isValidEndpoint(source.endpoint)).toBe(true);
    expect(isValidEndpoint('file:///C:/x')).toBe(false);
    expect(isValidEndpoint('http://user:pw@host/api')).toBe(false);
    expect(isValidEndpoint('not a url')).toBe(false);
  });

  it('fetches links only from the source host, or magnets', () => {
    expect(isAllowedDownloadUrl('http://127.0.0.1:9117/dl/x', source.endpoint)).toBe(true);
    expect(isAllowedDownloadUrl('magnet:?xt=urn:btih:abc', source.endpoint)).toBe(true);
    expect(isAllowedDownloadUrl('http://169.254.169.254/latest', source.endpoint)).toBe(false);
    expect(isAllowedDownloadUrl('http://127.0.0.1:8080/admin', source.endpoint)).toBe(false);
    expect(isAllowedDownloadUrl('file:///etc/passwd', source.endpoint)).toBe(false);
  });
});

describe('buildQueries', () => {
  const full = parseCaps(fixture('caps.xml'));
  const basic = parseCaps(fixture('caps-basic.xml'));
  const movie: SearchTarget = {
    kind: 'movie',
    tmdbId: 10331,
    imdbId: 'tt0063350',
    title: 'Noc żywych trupów',
    originalTitle: 'Night of the Living Dead',
    year: 1968,
  };
  const episode: SearchTarget = {
    kind: 'episode',
    tmdbId: 1,
    title: 'Example Show',
    originalTitle: 'Example Show',
    year: 2019,
    season: 2,
    episode: 5,
  };

  it('uses imdbid when supported, plus the Polish title', () => {
    expect(buildQueries(movie, full)).toEqual([
      { t: 'movie', imdbid: 'tt0063350' },
      { t: 'search', q: 'Noc żywych trupów 1968', cat: '2000' },
    ]);
  });

  it('falls back to title + year for both titles', () => {
    expect(buildQueries(movie, basic)).toEqual([
      { t: 'search', q: 'Night of the Living Dead 1968', cat: '2000' },
      { t: 'search', q: 'Noc żywych trupów 1968', cat: '2000' },
    ]);
  });

  it('uses tvsearch with season/ep, or SxxEyy text', () => {
    expect(buildQueries(episode, full)).toEqual([{ t: 'tvsearch', q: 'Example Show', season: '2', ep: '5' }]);
    expect(buildQueries(episode, basic)).toEqual([{ t: 'search', q: 'Example Show S02E05', cat: '5000' }]);
  });
});
