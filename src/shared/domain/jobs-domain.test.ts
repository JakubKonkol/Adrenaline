import { describe, expect, it } from 'vitest';
import { fileKind, selectDefaultFiles, type TorrentFile } from './file-selection';
import { canTransition, JOB_STATES, type JobState } from './job-state';
import { deriveJobStatus } from './job-status';
import type { SearchTarget } from './search-target';

describe('job-state transitions', () => {
  it.each<[JobState, JobState]>([
    ['queued', 'fetching_metadata'],
    ['fetching_metadata', 'awaiting_file_selection'],
    ['awaiting_file_selection', 'downloading'],
    ['downloading', 'paused'],
    ['paused', 'downloading'],
    ['downloading', 'checking'],
    ['checking', 'downloaded'],
    ['downloaded', 'seeding'],
    ['seeding', 'stopped'],
    ['downloading', 'error'],
    ['error', 'downloading'],
    ['seeding', 'removed'],
  ])('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each<[JobState, JobState]>([
    ['removed', 'downloading'],
    ['removed', 'queued'],
    ['queued', 'seeding'],
    ['downloading', 'stopped'],
    ['fetching_metadata', 'seeding'],
  ])('rejects %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('allows every state to be removed except removed itself, and staying in place', () => {
    for (const s of JOB_STATES) {
      expect(canTransition(s, s)).toBe(true);
      if (s !== 'removed') expect(canTransition(s, 'removed')).toBe(true);
    }
  });
});

describe('deriveJobStatus (BR02, BR03)', () => {
  const done = [
    { selected: true, size: 10, doneBytes: 10 },
    { selected: false, size: 5, doneBytes: 0 },
  ];
  const half = [{ selected: true, size: 10, doneBytes: 5 }];

  it('is ready only when files and subtitles are ready', () => {
    expect(deriveJobStatus({ state: 'seeding', pauseReason: null }, done, [{ state: 'ready' }])).toEqual({
      kind: 'ready',
      ready: true,
      seeding: true,
      filesComplete: true,
    });
  });

  it('treats disabled subtitles as done', () => {
    expect(deriveJobStatus({ state: 'stopped', pauseReason: null }, done, [{ state: 'disabled' }]).kind).toBe('ready');
    expect(deriveJobStatus({ state: 'downloaded', pauseReason: null }, done, []).kind).toBe('ready');
  });

  it('D-78: skipped subtitles never hold back readiness, whatever their tasks say', () => {
    const job = { state: 'seeding', pauseReason: null, subtitleLang: null } as const;
    expect(deriveJobStatus(job, done, [{ state: 'error' }, { state: 'searching' }]).kind).toBe('ready');
    expect(deriveJobStatus({ ...job, subtitleLang: 'en' }, done, [{ state: 'error' }]).kind).toBe(
      'ready_subtitles_attention',
    );
  });

  it('film ready, subtitles need attention (partial success)', () => {
    for (const state of ['not_found', 'quota_exceeded', 'error', 'needs_selection'] as const) {
      expect(deriveJobStatus({ state: 'seeding', pauseReason: null }, done, [{ state }])).toMatchObject({
        kind: 'ready_subtitles_attention',
        ready: false,
        filesComplete: true,
      });
    }
    expect(deriveJobStatus({ state: 'seeding', pauseReason: null }, done, [{ state: 'searching' }]).kind).toBe(
      'subtitles_in_progress',
    );
  });

  it('shows pause reasons for disk problems', () => {
    expect(deriveJobStatus({ state: 'paused', pauseReason: 'disk_full' }, half, []).kind).toBe('paused_disk_full');
    expect(deriveJobStatus({ state: 'paused', pauseReason: 'disk_missing' }, half, []).kind).toBe(
      'paused_disk_missing',
    );
    expect(deriveJobStatus({ state: 'paused', pauseReason: 'user' }, half, []).kind).toBe('paused');
  });

  it('a paused completed download is still ready', () => {
    expect(deriveJobStatus({ state: 'paused', pauseReason: 'user' }, done, [])).toMatchObject({
      kind: 'ready',
      seeding: false,
    });
  });
});

const movie: SearchTarget = { kind: 'movie', tmdbId: 1, title: 'Film', originalTitle: 'Film', year: 2020 };
const episode: SearchTarget = {
  kind: 'episode',
  tmdbId: 2,
  title: 'Show',
  originalTitle: 'Show',
  year: 2020,
  season: 2,
  episode: 3,
};
const f = (index: number, path: string, size: number, pad = false): TorrentFile => ({ index, path, size, pad });
const GB = 1024 ** 3;

describe('selectDefaultFiles (FR09)', () => {
  it('picks the largest video, skipping samples, executables and archives', () => {
    const r = selectDefaultFiles(
      [
        f(0, 'Film.2020/Film.2020.1080p.mkv', 4 * GB),
        f(1, 'Film.2020/Sample/sample.mkv', 0.6 * GB),
        f(2, 'Film.2020/Film.2020.1080p.exe', 5 * GB),
        f(3, 'Film.2020/extras.rar', 6 * GB),
        f(4, 'Film.2020/Film.nfo', 1000),
        f(5, '.pad/123', 100, true),
      ],
      movie,
    );
    expect(r).toEqual({ selected: [0], ambiguous: false, candidates: [0, 1], blocked: [2, 3] });
  });

  it('asks the user when two big videos compete', () => {
    const r = selectDefaultFiles([f(0, 'A.Part1.mkv', 3 * GB), f(1, 'A.Part2.mkv', 2.8 * GB)], movie);
    expect(r.ambiguous).toBe(true);
    expect(r.selected).toEqual([0]);
  });

  it('picks the matching episode from a season pack', () => {
    const r = selectDefaultFiles(
      [
        f(0, 'Show.S02/Show.S02E01.720p.mkv', GB),
        f(1, 'Show.S02/Show.S02E03.720p.mkv', GB),
        f(2, 'Show.S02/Show.S02E04.720p.mkv', GB),
      ],
      episode,
    );
    expect(r).toMatchObject({ selected: [1], ambiguous: false });
  });

  it('is ambiguous when no episode matches', () => {
    const r = selectDefaultFiles([f(0, 'Show.S02E01.mkv', GB), f(1, 'Show.S02E02.mkv', GB)], episode);
    expect(r).toMatchObject({ selected: [], ambiguous: true, candidates: [0, 1] });
  });

  it('takes the only video of a single-episode release without SxxEyy in the name', () => {
    expect(
      selectDefaultFiles([f(0, 'Show 2x03/video.mkv', GB), f(1, 'Show 2x03/info.txt', 10)], episode),
    ).toMatchObject({
      selected: [0],
      ambiguous: false,
    });
  });

  it('classifies files', () => {
    expect(fileKind('a/b.MKV')).toBe('video');
    expect(fileKind('setup.exe')).toBe('executable');
    expect(fileKind('payload.js')).toBe('executable');
    expect(fileKind('movie.r00')).toBe('archive');
    expect(fileKind('pl.srt')).toBe('subtitle');
  });
});
