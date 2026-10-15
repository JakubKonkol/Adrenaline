import { expect, it } from 'vitest';
import type { SubtitleCandidate } from '../contracts/subtitles';
import { automaticSubtitle, rankSubtitles } from './subtitle-ranking';

const release = 'Example.Film.2020.1080p.BluRay.x264-GRP';
const candidate: SubtitleCandidate = {
  id: '1',
  fileId: 1,
  fileName: 'file.srt',
  language: 'pl',
  release,
  hearingImpaired: false,
  foreignPartsOnly: false,
  moviehashMatch: false,
  downloadCount: 0,
  ratings: 0,
  fromTrusted: false,
  machineTranslated: false,
};
it('prefers hash over popularity, excludes forced/machine from automatic selection', () => {
  const ranked = rankSubtitles(
    [
      { ...candidate, fileId: 1, moviehashMatch: true },
      { ...candidate, fileId: 2, release: 'Other', downloadCount: 1e9 },
      { ...candidate, fileId: 3, moviehashMatch: true, foreignPartsOnly: true },
    ],
    release,
  );
  expect(automaticSubtitle(ranked)?.fileId).toBe(1);
  expect(ranked.find((c) => c.fileId === 3)?.confidence).toBe('low');
});
it('requires release group/source/resolution, rejects edition conflicts and asks on ambiguous ties', () => {
  expect(automaticSubtitle(rankSubtitles([candidate], release))?.confidence).toBe('medium');
  expect(automaticSubtitle(rankSubtitles([candidate], release.replace('2020', '2020.Extended')))).toBeNull();
  expect(
    automaticSubtitle(rankSubtitles([candidate, { ...candidate, fileId: 2, downloadCount: 99999 }], release)),
  ).toBeNull();
  expect(automaticSubtitle(rankSubtitles([{ ...candidate, release: 'Unknown' }], release))).toBeNull();
});
it('prefers a non-SDH match when confidence is equal', () => {
  expect(
    automaticSubtitle(
      rankSubtitles(
        [
          { ...candidate, hearingImpaired: true },
          { ...candidate, fileId: 2 },
        ],
        release,
      ),
    )?.fileId,
  ).toBe(2);
});
