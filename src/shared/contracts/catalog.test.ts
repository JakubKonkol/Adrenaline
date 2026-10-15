import { describe, expect, it } from 'vitest';
import { ipcChannels } from './ipc';

describe('catalog IPC validation', () => {
  it.each([
    { type: 'tv', tmdbId: 1 },
    { type: 'movie', tmdbId: 1, season: 1, episode: 2 },
    { type: 'tv', tmdbId: 1, season: -1, episode: 2 },
    { type: 'tv', tmdbId: 1, season: 1, episode: 0 },
    { type: 'movie', tmdbId: 1, title: 'Forged metadata' },
  ])('rejects invalid selection %j', (input) => {
    expect(ipcChannels['catalog:select'].input.safeParse(input).success).toBe(false);
  });
  it('accepts movies and episodes, including season zero', () => {
    expect(ipcChannels['catalog:select'].input.safeParse({ type: 'movie', tmdbId: 1 }).success).toBe(true);
    expect(
      ipcChannels['catalog:select'].input.safeParse({ type: 'tv', tmdbId: 1, season: 0, episode: 1 }).success,
    ).toBe(true);
  });
  it('bounds search input and rejects extra fields and unsupported media types', () => {
    expect(ipcChannels['catalog:search'].input.safeParse({ query: 'x'.repeat(301) }).success).toBe(false);
    expect(ipcChannels['catalog:search'].input.safeParse({ query: 'a', apiKey: 'secret' }).success).toBe(false);
    expect(ipcChannels['catalog:details'].input.safeParse({ type: 'person', tmdbId: 1 }).success).toBe(false);
    expect(ipcChannels['catalog:details'].input.safeParse({ type: 'movie', tmdbId: -1 }).success).toBe(false);
  });
});
