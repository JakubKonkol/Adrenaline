import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Release, ReleaseSession } from '@shared/contracts/releases';
import type { TvSubtitleChoices } from '@shared/contracts/tv';
import { clearCache } from '../data';
import { resetFocusRegistry } from '../focus';
import { Releases } from './Releases';

const mocks = vi.hoisted(() => ({
  startReleaseSearch: vi.fn(),
  releaseSession: vi.fn(),
  cancelReleaseSearch: vi.fn(),
  subtitleChoices: vi.fn(),
  createDownload: vi.fn(),
  showToast: vi.fn(),
  reset: vi.fn(),
  subtitles: true,
}));
vi.mock('../session', () => ({
  useSession: () => ({ api: mocks, session: { features: { subtitles: mocks.subtitles } } }),
}));
vi.mock('../nav', () => ({ useNav: () => mocks, useBackHandler: () => undefined }));

const release = (id: string, resolution: '2160p' | '1080p' | null, seeders = 5): Release => ({
  id,
  name: `Film.2020.${resolution ?? 'unknown'}.${id}`,
  size: 1_000_000,
  infoHashV1: null,
  infoHashV2: null,
  publishedAt: null,
  parsed: {
    title: 'Film',
    year: 2020,
    resolution,
    source: 'WEB-DL',
    codec: 'x264',
    hdr: null,
    audio: [],
    languages: [],
    edition: null,
    group: null,
    season: null,
    episode: null,
    isSeasonPack: false,
  },
  match: { score: 100, warnings: [] },
  seeders: { value: seeders, sourceName: 'A', observedAt: 0 },
  peers: 0,
  sources: [],
  downloadable: true,
});
const hd = release('hd', '1080p'),
  uhd = release('uhd', '2160p', 10),
  unknown = release('unknown', null);
const session: ReleaseSession = {
  id: 's',
  target: { kind: 'movie', tmdbId: 1, title: 'Film', originalTitle: 'Film', year: 2020 },
  sources: [],
  releases: [hd, uhd, unknown],
  done: true,
  outcome: 'results',
  startedAt: 0,
  finishedAt: 1,
  fromCache: false,
};
const choices: TvSubtitleChoices = {
  language: 'pl',
  providers: ['opensubtitles', 'napiprojekt'],
  errorCode: null,
  candidates: [
    {
      provider: 'opensubtitles',
      id: 'a',
      fileId: 42,
      fileName: 'Film.2020.srt',
      language: 'pl',
      release: hd.name,
      hearingImpaired: false,
      foreignPartsOnly: false,
      moviehashMatch: false,
      downloadCount: 1,
      ratings: 1,
      fromTrusted: true,
      machineTranslated: false,
      confidence: 'medium',
      score: 60,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  clearCache();
  resetFocusRegistry();
  mocks.subtitles = true;
  mocks.startReleaseSearch.mockResolvedValue({ sessionId: 's' });
  mocks.releaseSession.mockResolvedValue(session);
  mocks.cancelReleaseSearch.mockResolvedValue(undefined);
  mocks.subtitleChoices.mockResolvedValue(choices);
  mocks.createDownload.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  resetFocusRegistry();
});
const open = () => render(<Releases selection={{ type: 'movie', tmdbId: 1 }} title="Film" subtitle={null} />);

it('filters quality including unknown values, clears an empty result and sorts by seeders using the remote controls', async () => {
  open();
  await screen.findByText(hd.name);
  fireEvent.click(screen.getByRole('button', { name: '4K' }));
  expect(screen.queryByText(hd.name)).toBeNull();
  expect(screen.getByText(uhd.name)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Other / unknown' }));
  expect(screen.getByText(unknown.name)).toBeTruthy();
  expect(screen.queryByText(uhd.name)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '720p' }));
  expect(screen.getByText(/No releases match/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  fireEvent.click(screen.getByRole('button', { name: 'Sort: Best match' }));
  const first = document.querySelector('.release-list .release-name');
  expect(first?.textContent).toBe(uhd.name);
});

it('asks about subtitles, lists files and sends only the selected subtitle reference when starting a download', async () => {
  open();
  fireEvent.click(await screen.findByText(hd.name));
  expect(screen.getByRole('dialog', { name: 'Download subtitles too?' })).toBeTruthy();
  expect(mocks.createDownload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, choose subtitles' }));
  fireEvent.click(await screen.findByText('Film.2020.srt'));
  await waitFor(() =>
    expect(mocks.createDownload).toHaveBeenCalledExactlyOnceWith('s', 'hd', true, { subtitleFileId: 42 }),
  );
  expect(mocks.reset).toHaveBeenCalledWith({ name: 'home', tab: 'library' });
});

it('can skip subtitles with no credentials and can choose file matching after the movie downloads', async () => {
  mocks.subtitles = false;
  open();
  fireEvent.click(await screen.findByText(hd.name));
  expect(screen.getByRole('button', { name: 'Yes, choose subtitles' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Download without subtitles' }));
  await waitFor(() => expect(mocks.createDownload).toHaveBeenCalledWith('s', 'hd', false, undefined));
  expect(mocks.subtitleChoices).not.toHaveBeenCalled();
  cleanup();
  mocks.subtitles = true;
  mocks.createDownload.mockClear();
  open();
  fireEvent.click(await screen.findByText(hd.name));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, choose subtitles' }));
  fireEvent.click(await screen.findByRole('button', { name: 'NapiProjekt: match after download' }));
  await waitFor(() =>
    expect(mocks.createDownload).toHaveBeenCalledExactlyOnceWith('s', 'hd', true, { subtitleProvider: 'napiprojekt' }),
  );
});

it('allows downloading without subtitles when subtitle search fails', async () => {
  mocks.subtitleChoices.mockRejectedValue(new Error('offline'));
  open();
  fireEvent.click(await screen.findByText(hd.name));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, choose subtitles' }));
  await screen.findByText('Can’t reach your PC.');
  fireEvent.click(screen.getByRole('button', { name: 'Download without subtitles' }));
  await waitFor(() => expect(mocks.createDownload).toHaveBeenCalledExactlyOnceWith('s', 'hd', false, undefined));
});
