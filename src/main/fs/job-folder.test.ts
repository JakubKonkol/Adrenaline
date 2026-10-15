import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobFolder, numberedVariant } from './job-folder';

const W = path.win32;
const BASE = 'C:\\Users\\Jakub\\Videos\\Adrenaline';

describe('jobFolder (D-75)', () => {
  it('builds film folders with a sanitized title and year', () => {
    expect(
      jobFolder(
        BASE,
        { kind: 'movie', tmdbId: 1, title: 'Mission: Impossible', originalTitle: 'x', year: 1996 },
        'Mission.Impossible.1996.1080p',
        W,
      ),
    ).toBe(`${BASE}\\Mission - Impossible (1996)\\Mission.Impossible.1996.1080p`);
  });

  it('builds episode folders with the season number', () => {
    expect(
      jobFolder(
        BASE,
        {
          kind: 'episode',
          tmdbId: 2,
          title: 'Przykładowy serial',
          originalTitle: 'x',
          year: 2020,
          season: 3,
          episode: 1,
        },
        'Show.S03E01.WEB',
        W,
      ),
    ).toBe(`${BASE}\\Przykładowy serial\\Season 03\\Show.S03E01.WEB`);
  });

  it('never produces unsafe names from release names', () => {
    const p = jobFolder(
      BASE,
      { kind: 'movie', tmdbId: 1, title: 'CON', originalTitle: 'x', year: null },
      '../evil:name?',
      W,
    );
    expect(p).toBe(`${BASE}\\_CON\\..-evil - name`);
    expect(p.startsWith(BASE)).toBe(true);
  });

  it('numbers conflicting folders', () => {
    expect(numberedVariant(`${BASE}\\Film (2020)\\Rel`, 2, W)).toBe(`${BASE}\\Film (2020)\\Rel (2)`);
  });
});
