import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { SubtitleCandidate } from '@shared/contracts/subtitles';
import { AppError } from '@shared/errors';
import { nullLogger } from '../logger';
import { openDatabase } from '../persistence/db';
import { JobsRepository } from '../persistence/repositories/jobs';
import { SubtitlesRepository } from '../persistence/repositories/subtitles';
import type { OpenSubtitlesClient } from '../providers/opensubtitles/opensubtitles-client';
import { SubtitleService } from './subtitle-service';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
const srt = '1\n00:00:01,000 --> 00:00:02,000\nCześć!\n';
const candidate: SubtitleCandidate = {
  id: '1',
  fileId: 1,
  fileName: 'film.srt',
  language: 'pl',
  release: 'Film.2020.1080p.BluRay.x264-GRP',
  moviehashMatch: true,
  foreignPartsOnly: false,
  hearingImpaired: false,
  fromTrusted: true,
  machineTranslated: false,
  downloadCount: 1,
  ratings: 1,
};
function setup() {
  const base = mkdtempSync(join(tmpdir(), 'adr-sub-'));
  const db = openDatabase(':memory:', { log: nullLogger });
  const jobs = new JobsRepository(db),
    tasks = new SubtitlesRepository(db);
  const video = 'Film.2020.1080p.BluRay.x264-GRP.mkv';
  writeFileSync(join(base, video), Buffer.alloc(131072));
  jobs.insert({
    id: 'job',
    mediaItemId: null,
    episodeId: null,
    target: { kind: 'movie', tmdbId: 123, title: 'Film', originalTitle: 'Film', year: 2020 },
    release: { name: video, sources: [], size: 131072, suggestedFiles: [0] },
    sourceKind: 'magnet',
    magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40),
    torrent: null,
    infoHashV1: 'a'.repeat(40),
    infoHashV2: null,
    saveDir: base,
    state: 'downloading',
    pauseReason: null,
    resumeState: null,
    errorCode: null,
    errorMessage: null,
    totalBytes: 131072,
    doneBytes: 0,
    seedRatioLimit: 0,
    seedTimeLimitMin: 0,
    subtitleLang: 'pl',
    subtitleFallbackLang: 'en',
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
  });
  jobs.replaceFiles('job', [
    { index: 0, relPath: video, size: 131072, selected: true, doneBytes: 0 },
    { index: 1, relPath: 'sample.mkv', size: 1, selected: false, doneBytes: 0 },
  ]);
  const client = {
    search: vi.fn<OpenSubtitlesClient['search']>(() => Promise.resolve([candidate])),
    downloadLink: vi.fn<OpenSubtitlesClient['downloadLink']>(() =>
      Promise.resolve({
        link: 'https://dl.opensubtitles.com/test',
        fileName: 'film.srt',
        remaining: 0,
        resetTimeUtc: null,
      }),
    ),
    fetchFile: vi.fn<OpenSubtitlesClient['fetchFile']>(() => Promise.resolve(Buffer.from(srt))),
  };
  const changed = vi.fn();
  const service = new SubtitleService({ jobs, tasks, client, changed });
  cleanups.push(() => {
    service.stop();
    db.close();
    rmSync(base, { recursive: true, force: true });
  });
  return { base, video, db, jobs, tasks, client, changed, service };
}
it('waits for completion, saves one task per selected video, preserves existing sidecars and movie', async () => {
  const { service, tasks, client, base, video } = setup();
  const original = join(base, video.replace('.mkv', '.pl.srt'));
  writeFileSync(original, 'user subtitles');
  service.sync('job');
  await service.idle();
  expect(client.search).not.toHaveBeenCalled();
  expect(tasks.list('job')).toHaveLength(1);
  service.complete('job', 0);
  service.complete('job', 0);
  await service.idle();
  const task = tasks.list('job')[0]!;
  expect(task.state).toBe('ready');
  expect(task.targetPath).toMatch(/\.pl\.2\.srt$/);
  expect(readFileSync(task.targetPath!, 'utf8')).toBe(srt);
  expect(readFileSync(original, 'utf8')).toBe('user subtitles');
  expect(readFileSync(join(base, video)).length).toBe(131072);
  expect(client.downloadLink).toHaveBeenCalledOnce();
  expect(readdirSync(base).some((f) => f.endsWith('.tmp'))).toBe(false);
});
it('searches fallback only when primary has no results, uses episode IDs', async () => {
  const { service, tasks, client, db } = setup();
  db.prepare("UPDATE download_jobs SET target_json = ? WHERE id = 'job'").run(
    JSON.stringify({
      kind: 'episode',
      tmdbId: 456,
      title: 'Show',
      originalTitle: 'Show',
      year: 2020,
      season: 2,
      episode: 3,
    }),
  );
  client.search.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...candidate, language: 'en' }]);
  service.complete('job', 0);
  await service.idle();
  expect(client.search.mock.calls[0]?.[0]).toMatchObject({
    parentTmdbId: 456,
    season: 2,
    episode: 3,
    languages: ['pl'],
  });
  expect(client.search.mock.calls[1]?.[0]).toMatchObject({ languages: ['en'] });
  expect(tasks.list('job')[0]).toMatchObject({ lang: 'en', state: 'ready' });
});
it('asks for ambiguous choice and validates candidate belongs to that task', async () => {
  const { service, tasks, client } = setup();
  client.search.mockResolvedValue([candidate, { ...candidate, id: '2', fileId: 2 }]);
  service.complete('job', 0);
  await service.idle();
  const task = tasks.list('job')[0]!;
  expect(task.state).toBe('needs_selection');
  expect(client.downloadLink).not.toHaveBeenCalled();
  await expect(service.retry('job', task.id, 999)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await service.retry('job', task.id, 2);
  expect(client.downloadLink).toHaveBeenCalledWith(2);
  expect(tasks.list('job')[0]?.state).toBe('ready');
});
it('quota failure leaves movie state intact and never automatically retries POST', async () => {
  const { service, tasks, client, jobs } = setup();
  client.downloadLink.mockRejectedValue(new AppError('SUBS_QUOTA', 'quota', { resetAt: Date.now() + 60000 }));
  service.complete('job', 0);
  await service.idle();
  service.sync('job');
  await service.idle();
  const task = tasks.list('job')[0]!;
  expect(task.state).toBe('quota_exceeded');
  expect(jobs.get('job')?.state).toBe('downloading');
  expect(client.downloadLink).toHaveBeenCalledOnce();
  await expect(service.retry('job', task.id)).rejects.toMatchObject({ code: 'SUBS_QUOTA' });
});
it('explicit retry works without any engine dependency and disabling skips network', async () => {
  const { service, tasks, client } = setup();
  client.fetchFile.mockRejectedValueOnce(new AppError('SUBS_UNAVAILABLE'));
  service.complete('job', 0);
  await service.idle();
  expect(tasks.list('job')[0]?.state).toBe('error');
  await service.retry('job', tasks.list('job')[0]!.id);
  expect(tasks.list('job')[0]?.state).toBe('ready');
  await service.language('job', null, null);
  service.complete('job', 0);
  await service.idle();
  expect(tasks.list('job')[0]?.state).toBe('disabled');
  expect(client.downloadLink).toHaveBeenCalledTimes(2);
});
it('cancels before writing when a job is removed during a request', async () => {
  const { service, client, base } = setup();
  let finish!: (data: Buffer) => void;
  client.fetchFile.mockImplementationOnce(
    () =>
      new Promise<Buffer>((r) => {
        finish = r;
      }),
  );
  service.complete('job', 0);
  await vi.waitFor(() => expect(client.fetchFile).toHaveBeenCalledOnce());
  const cancelled = service.cancel('job');
  finish(Buffer.from(srt));
  await cancelled;
  expect(readdirSync(base).filter((f) => f.endsWith('.srt'))).toHaveLength(0);
});
it('restores interrupted searches but requires explicit retry after an interrupted download', async () => {
  const { service, tasks, client, jobs } = setup();
  service.sync('job');
  const task = tasks.list('job')[0]!;
  tasks.update(task.id, { state: 'downloading' });
  jobs.update('job', { state: 'downloaded' });
  jobs.saveProgress('job', 131072, [{ index: 0, doneBytes: 131072 }]);
  service.restore();
  await service.idle();
  expect(tasks.list('job')[0]?.state).toBe('error');
  expect(client.downloadLink).not.toHaveBeenCalled();
  await service.retry('job', task.id);
  expect(tasks.list('job')[0]?.state).toBe('ready');
});
