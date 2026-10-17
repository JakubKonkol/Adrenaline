import { expect, it, vi } from 'vitest';
import type { SubtitleCandidate, SubtitleProvider } from '@shared/contracts/subtitles';
import { HashSubtitlesClient } from '../providers/hash-subtitles';
import { SubtitleProviders } from './subtitle-providers';

const candidate: SubtitleCandidate = {
  provider: 'napiprojekt',
  id: 'napi:1',
  fileId: 2 ** 40,
  fileName: 'film.srt',
  language: 'pl',
  release: 'Film',
  hearingImpaired: false,
  foreignPartsOnly: false,
  moviehashMatch: true,
  downloadCount: 0,
  ratings: 0,
  fromTrusted: false,
  machineTranslated: false,
};
function setup(available: SubtitleProvider[] = ['opensubtitles', 'napiprojekt', 'napisy24']) {
  const open = {
    search: vi.fn().mockResolvedValue([]),
    downloadLink: vi.fn().mockResolvedValue({ link: 'https://dl.opensubtitles.com/1', fileName: 'film.srt' }),
    fetchFile: vi.fn().mockResolvedValue(Buffer.from('os')),
  };
  const hash = new HashSubtitlesClient();
  const search = vi
    .spyOn(hash, 'search')
    .mockImplementation((provider) =>
      Promise.resolve([{ candidate: { ...candidate, provider }, data: Buffer.from(provider), fileName: 'film.srt' }]),
    );
  return { open, search, client: new SubtitleProviders({ open, hash, available: () => available }) };
}

it('keeps hash matches when OpenSubtitles fails, and routes selection to the right provider', async () => {
  const { client, open, search } = setup();
  open.search.mockRejectedValue(new Error('no key'));
  const results = await client.search({ languages: ['pl'], videoPath: 'movie.mkv' });
  expect(results.map((c) => c.provider)).toEqual(['napiprojekt', 'napisy24']);
  expect((await client.downloadCandidate(results[0]!, 'movie.mkv')).data.toString()).toBe('napiprojekt');
  expect(search).toHaveBeenCalledTimes(2);
  expect(open.downloadLink).not.toHaveBeenCalled();
});

it('shares pending hash searches and caches empty answers for at least 15 minutes', async () => {
  const { client, search } = setup(['napisy24']);
  search.mockResolvedValue([]);
  await Promise.all([
    client.search({ languages: ['pl'], videoPath: 'movie.mkv' }),
    client.search({ languages: ['pl'], videoPath: 'movie.mkv' }),
  ]);
  await client.search({ languages: ['pl'], videoPath: 'movie.mkv' });
  expect(search).toHaveBeenCalledOnce();
});

it('skips file hash providers before video download, for non-Polish languages and when another provider was chosen', async () => {
  const { client, search, open } = setup();
  await client.search({ languages: ['pl'] });
  await client.search({ languages: ['en'], videoPath: 'movie.mkv' });
  expect(search).not.toHaveBeenCalled();
  open.search.mockClear();
  await client.search({ languages: ['pl'], videoPath: 'movie.mkv', provider: 'napiprojekt' });
  expect(search).toHaveBeenCalledExactlyOnceWith('napiprojekt', 'movie.mkv');
  expect(open.search).not.toHaveBeenCalled();
});

it('preserves OpenSubtitles download quotas by downloading only the selected file', async () => {
  const { client, open } = setup();
  const selected = { ...candidate, provider: 'opensubtitles' as const, fileId: 12 };
  expect((await client.downloadCandidate(selected, 'movie.mkv')).data.toString()).toBe('os');
  expect(open.downloadLink).toHaveBeenCalledExactlyOnceWith(12);
});
