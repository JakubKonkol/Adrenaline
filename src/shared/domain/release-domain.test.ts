import { describe, expect, it } from 'vitest';
import { parseMagnet } from './magnet';
import { compareReleases, matchRelease, type Rankable } from './match';
import { bestSeeders, dedupe, type SourceHit } from './release';
import { parseReleaseName } from './release-parser';
import type { SearchTarget } from './search-target';

const HEX = '0123456789abcdef0123456789abcdef01234567';
const V2 = 'a'.repeat(64);

describe('parseMagnet', () => {
  it('reads hex and base32 btih, btmh, name and trackers', () => {
    expect(parseMagnet(`magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Film&tr=udp%3A%2F%2Ft.example%3A1`)).toEqual({
      infoHashV1: HEX,
      infoHashV2: null,
      name: 'Film',
      trackers: ['udp://t.example:1'],
    });
    // base32 of 20 bytes 0x00..0x13
    const b32 = 'AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQT';
    expect(parseMagnet(`magnet:?xt=urn:btih:${b32}`)?.infoHashV1).toBe('000102030405060708090a0b0c0d0e0f10111213');
    expect(parseMagnet(`magnet:?xt=urn:btmh:1220${V2}`)).toMatchObject({ infoHashV1: null, infoHashV2: V2 });
  });

  it('rejects invalid magnets', () => {
    expect(parseMagnet('http://example.com')).toBeNull();
    expect(parseMagnet('magnet:?xt=urn:btih:nothex')).toBeNull();
    expect(parseMagnet('magnet:?dn=only-name')).toBeNull();
  });
});

const hit = (over: Partial<SourceHit>): SourceHit => ({
  sourceId: 'a',
  sourceName: 'A',
  guid: 'g',
  title: 'Film.2020.1080p.WEB-DL.x264-GRP',
  size: 1000,
  publishedAt: null,
  seeders: 10,
  peers: 12,
  infoHash: null,
  magnet: null,
  link: null,
  imdbId: null,
  observedAt: 1,
  ...over,
});

describe('dedupe (FR04, BR08)', () => {
  it('merges the same hash from two sources into one row with both sources', () => {
    const merged = dedupe([
      hit({ sourceId: 'a', sourceName: 'A', infoHash: HEX, seeders: 10 }),
      hit({
        sourceId: 'b',
        sourceName: 'B',
        magnet: `magnet:?xt=urn:btih:${HEX}`,
        seeders: 25,
        observedAt: 2,
        title: 'Film 2020 1080p',
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.hits.map((h) => h.sourceId)).toEqual(['a', 'b']);
    expect(merged[0]!.name).toBe('Film 2020 1080p');
    // Seeders are the maximum with its source, not a sum.
    expect(bestSeeders(merged[0]!.hits)).toEqual({ value: 25, sourceName: 'B', observedAt: 2 });
  });

  it('matches v1 and v2 hashes of a hybrid torrent', () => {
    const merged = dedupe([
      hit({ sourceId: 'a', magnet: `magnet:?xt=urn:btih:${HEX}&xt=urn:btmh:1220${V2}` }),
      hit({ sourceId: 'b', infoHash: V2 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ infoHashV1: HEX, infoHashV2: V2 });
  });

  it('never merges results without a hash', () => {
    expect(dedupe([hit({ sourceId: 'a' }), hit({ sourceId: 'b' })])).toHaveLength(2);
  });

  it('reports unknown seeders as null', () => {
    expect(bestSeeders([hit({ seeders: null })])).toBeNull();
  });
});

const movie: SearchTarget = {
  kind: 'movie',
  tmdbId: 10331,
  title: 'Noc żywych trupów',
  originalTitle: 'Night of the Living Dead',
  year: 1968,
};
const episode: SearchTarget = {
  kind: 'episode',
  tmdbId: 1,
  title: 'Przykładowy serial',
  originalTitle: 'Example Show',
  year: 2019,
  season: 2,
  episode: 5,
};
const m = (name: string, target: SearchTarget) => matchRelease(parseReleaseName(name), target);

describe('matchRelease', () => {
  it('scores the right movie and year highest', () => {
    const right = m('Night.of.the.Living.Dead.1968.1080p.BluRay.x264', movie);
    const remake = m('Night.of.the.Living.Dead.1990.1080p.BluRay.x264', movie);
    expect(right.score).toBeGreaterThan(remake.score);
    expect(right.warnings).toEqual([]);
    expect(remake.warnings).toContain('year_mismatch');
  });

  it('works with the Polish title too', () => {
    expect(m('Noc.Zywych.Trupow.1968.PL.720p', movie).warnings).toEqual([]);
  });

  it('flags CAM releases and series releases for a movie', () => {
    expect(m('Night.of.the.Living.Dead.1968.HDCAM', movie).warnings).toContain('cam');
    expect(m('Night.of.the.Living.Dead.S01E01.720p', movie).warnings).toContain('series_release');
  });

  it('handles episodes, season packs and other seasons (FR02)', () => {
    expect(m('Example.Show.S02E05.1080p.WEB-DL', episode)).toMatchObject({ warnings: [] });
    expect(m('Example.Show.S02.1080p.WEB-DL', episode).warnings).toEqual(['season_pack']);
    expect(m('Example.Show.S03E05.1080p.WEB-DL', episode).warnings).toEqual(['other_season']);
    expect(m('Example.Show.S02E06.1080p.WEB-DL', episode).warnings).toEqual(['other_episode']);
    const exact = m('Example.Show.S02E05.1080p.WEB-DL', episode).score;
    expect(exact).toBeGreaterThan(m('Example.Show.S02.1080p.WEB-DL', episode).score);
  });
});

describe('compareReleases (FR06)', () => {
  const r = (name: string, seeders: number | null, size: number | null): Rankable & { name: string } => {
    const parsed = parseReleaseName(name);
    return { name, parsed, match: matchRelease(parsed, movie), seeders, size };
  };
  const list = [
    r('Night.of.the.Living.Dead.1968.720p.BluRay', 500, 700),
    r('Night.of.the.Living.Dead.1968.1080p.BluRay', 50, 1500),
    r('Night.of.the.Living.Dead.1990.1080p.BluRay', 900, 1600),
    r('Night.of.the.Living.Dead.1968.2160p.BluRay', null, 9000),
  ];

  it('sorts by match, then preferred quality, then seeders', () => {
    expect([...list].sort((a, b) => compareReleases(a, b)).map((x) => x.name)).toEqual([
      'Night.of.the.Living.Dead.1968.1080p.BluRay',
      'Night.of.the.Living.Dead.1968.2160p.BluRay',
      'Night.of.the.Living.Dead.1968.720p.BluRay',
      'Night.of.the.Living.Dead.1990.1080p.BluRay',
    ]);
  });

  it('sorts by seeders or size on request, unknown last', () => {
    expect([...list].sort((a, b) => compareReleases(a, b, 'seeders')).map((x) => x.seeders)).toEqual([
      900,
      500,
      50,
      null,
    ]);
    expect([...list].sort((a, b) => compareReleases(a, b, 'size')).map((x) => x.size)).toEqual([9000, 1600, 1500, 700]);
  });
});
