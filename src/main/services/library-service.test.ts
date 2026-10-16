import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobState } from '@shared/domain/job-state';
import type { SearchTarget } from '@shared/domain/search-target';
import { nullLogger } from '../logger';
import { type Database, openDatabase } from '../persistence/db';
import { type JobRow, JobsRepository } from '../persistence/repositories/jobs';
import { MediaRepository } from '../persistence/repositories/media';
import { SubtitlesRepository } from '../persistence/repositories/subtitles';
import { LibraryService } from './library-service';

const dirs: string[] = [];
const dbs: Database[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'adr-lib-'));
  dirs.push(base);
  const db = openDatabase(':memory:', { log: nullLogger });
  dbs.push(db);
  const jobs = new JobsRepository(db);
  const subtitles = new SubtitlesRepository(db);
  const media = new MediaRepository(db);
  const removeJob = vi.fn(() => Promise.resolve());
  const shell = { openPath: vi.fn(() => Promise.resolve('')), showItemInFolder: vi.fn() };
  const library = new LibraryService({ jobs, subtitles, media, removeJob, shell });
  let n = 0;
  const add = (target: SearchTarget, state: JobState, files: { path: string; size: number; write?: boolean }[]) => {
    n += 1;
    const saveDir = join(base, `job${n}`);
    const job: JobRow = {
      id: `job-${n}`,
      mediaItemId: null,
      episodeId: null,
      target,
      release: { name: `Release.${n}`, sources: ['test'], size: null, suggestedFiles: [] },
      sourceKind: 'magnet',
      magnet: `magnet:?xt=urn:btih:${String(n).padStart(40, '0')}`,
      torrent: null,
      infoHashV1: String(n).padStart(40, '0'),
      infoHashV2: null,
      saveDir,
      state,
      pauseReason: null,
      resumeState: null,
      errorCode: null,
      errorMessage: null,
      totalBytes: null,
      doneBytes: 0,
      seedRatioLimit: null,
      seedTimeLimitMin: null,
      subtitleLang: null,
      subtitleFallbackLang: null,
      createdAt: n,
      updatedAt: n,
      completedAt: state === 'completed' ? 1000 + n : null,
    };
    jobs.insert(job);
    jobs.replaceFiles(
      job.id,
      files.map((f, index) => ({ index, relPath: f.path, size: f.size, selected: true, doneBytes: f.size })),
    );
    for (const f of files) {
      if (f.write === false) continue;
      const full = join(saveDir, f.path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, Buffer.alloc(f.size, 1));
    }
    return job;
  };
  return { library, add, jobs, subtitles, media, removeJob, shell, base };
}

const movie: SearchTarget = { kind: 'movie', tmdbId: 7, title: 'Film', originalTitle: 'Film', year: 2020 };
const episode: SearchTarget = {
  kind: 'episode',
  tmdbId: 9,
  title: 'Show',
  originalTitle: 'Show',
  year: 2019,
  season: 1,
  episode: 2,
};

describe('LibraryService (D-80)', () => {
  it('lists the finished video files only, newest first, without paths', async () => {
    const { library, add, media } = setup();
    media.saveSelection({
      type: 'movie',
      tmdbId: 7,
      title: 'Film',
      originalTitle: 'Film',
      year: 2020,
      posterPath: '/p.jpg',
      overview: '',
      popularity: 1,
      imdbId: null,
      genres: [],
      runtime: null,
      seasons: [],
    });
    add(movie, 'completed', [
      { path: 'Film/Film.mkv', size: 10 },
      { path: 'Film/readme.txt', size: 3 },
    ]);
    add(episode, 'completed', [{ path: 'Show.S01E02.mp4', size: 5 }]);
    add(movie, 'downloading', [{ path: 'Other.mkv', size: 5 }]);
    const items = await library.list();
    expect(items.map((i) => [i.title, i.fileName, i.available])).toEqual([
      ['Show', 'Show.S01E02.mp4', true],
      ['Film', 'Film.mkv', true],
    ]);
    expect(items[1]).toMatchObject({ posterPath: '/p.jpg', kind: 'movie', id: 'job-1~0' });
    expect(items[0]).toMatchObject({ season: 1, episode: 2, kind: 'episode' });
    expect(JSON.stringify(items)).not.toContain('job1');
  });

  it('marks files removed outside the app as unavailable and refuses to open them', async () => {
    const { library, add } = setup();
    add(movie, 'completed', [{ path: 'Gone.mkv', size: 4, write: false }]);
    const [item] = await library.list();
    expect(item?.available).toBe(false);
    await expect(library.resolve(item!.id)).rejects.toMatchObject({ code: 'FILE_MISSING' });
    await expect(library.play(item!.id)).rejects.toMatchObject({ code: 'FILE_MISSING' });
  });

  it('resolves the real file with its sidecar subtitles', async () => {
    const { library, add, subtitles } = setup();
    const job = add(movie, 'completed', [{ path: 'Film.mkv', size: 8 }]);
    const sidecar = join(job.saveDir, 'Film.en.srt');
    writeFileSync(sidecar, '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    const task = subtitles.ensure(job.id, 0, 'en');
    subtitles.update(task.id, { state: 'ready', targetPath: sidecar });
    const file = await library.resolve('job-1~0');
    expect(file.size).toBe(8);
    expect(file.subtitles.map((s) => s.lang)).toEqual(['en']);
    expect(file.item.subtitles).toEqual(['en']);
  });

  it('rejects unknown and malformed ids', async () => {
    const { library } = setup();
    await expect(library.resolve('nope~0')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(library.resolve('../../etc~1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not follow a symlink that replaced the video', async () => {
    const { library, add, base } = setup();
    const job = add(movie, 'completed', [{ path: 'Film.mkv', size: 4, write: false }]);
    const secret = join(base, 'secret.mkv');
    writeFileSync(secret, 'secret');
    mkdirSync(job.saveDir, { recursive: true });
    try {
      symlinkSync(secret, join(job.saveDir, 'Film.mkv'));
    } catch {
      return; // creating symlinks needs Developer Mode on Windows
    }
    await expect(library.resolve('job-1~0')).rejects.toMatchObject({ code: 'FILE_MISSING' });
  });

  it('plays, shows and removes through the injected adapters', async () => {
    const { library, add, shell, removeJob } = setup();
    add(movie, 'completed', [{ path: 'Film.mkv', size: 4 }]);
    await library.play('job-1~0');
    expect(shell.openPath).toHaveBeenCalledWith(expect.stringMatching(/Film\.mkv$/));
    await library.showInFolder('job-1~0');
    expect(shell.showItemInFolder).toHaveBeenCalled();
    await library.remove('job-1~0', true);
    expect(removeJob).toHaveBeenCalledWith('job-1', true);
  });
});
