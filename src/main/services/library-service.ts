import { lstat, realpath, stat } from 'node:fs/promises';
import { basename, dirname, relative, isAbsolute } from 'node:path';
import { type LibraryItem, libraryItemId, parseLibraryItemId } from '@shared/contracts/library';
import { fileKind } from '@shared/domain/file-selection';
import { COMPLETE_STATES } from '@shared/domain/job-state';
import { AppError } from '@shared/errors';
import { resolveInside } from '../fs/safe-path';
import type { JobRow, JobsRepository } from '../persistence/repositories/jobs';
import type { MediaRepository } from '../persistence/repositories/media';
import type { SubtitlesRepository } from '../persistence/repositories/subtitles';

export interface LibraryDeps {
  jobs: JobsRepository;
  subtitles: SubtitlesRepository;
  media: MediaRepository;
  /** Removes the whole download job (and optionally its files) through the download service. */
  removeJob: (jobId: string, deleteFiles: boolean) => Promise<void>;
  shell?: { openPath(path: string): Promise<string>; showItemInFolder(path: string): void };
}

/** A library file checked on disk; only main sees the paths (media server, desktop "Play"). */
export interface ResolvedLibraryFile {
  item: LibraryItem;
  path: string;
  size: number;
  mtimeMs: number;
  subtitles: { lang: string; path: string }[];
}

interface Candidate {
  job: JobRow;
  index: number;
  relPath: string;
  size: number;
}

function inside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Library (D-80, 1.0): every selected video file of a finished download. Finished means the engine verified the files
 * (`COMPLETE_STATES`), so a partial file is never listed. Files deleted or moved outside the app stay in the list as
 * unavailable (FILE_MISSING) until the user removes them.
 */
export class LibraryService {
  constructor(private readonly deps: LibraryDeps) {}

  private candidates(): Candidate[] {
    const out: Candidate[] = [];
    for (const job of this.deps.jobs.active()) {
      if (!COMPLETE_STATES.includes(job.state)) continue;
      for (const f of this.deps.jobs.files(job.id)) {
        if (f.selected && f.size > 0 && fileKind(f.relPath) === 'video')
          out.push({ job, index: f.index, relPath: f.relPath, size: f.size });
      }
    }
    return out;
  }

  private toItem(c: Candidate, available: boolean): LibraryItem {
    const t = c.job.target;
    const meta =
      t.kind === 'movie'
        ? this.deps.media.lookup('movie', t.tmdbId)
        : this.deps.media.lookup('tv', t.tmdbId, t.season, t.episode);
    const subtitles = this.deps.subtitles
      .list(c.job.id)
      .filter((s) => s.fileIndex === c.index && s.state === 'ready' && s.targetPath)
      .map((s) => s.lang);
    return {
      id: libraryItemId(c.job.id, c.index),
      jobId: c.job.id,
      kind: t.kind,
      tmdbId: t.tmdbId,
      title: t.title,
      year: t.year,
      season: t.kind === 'episode' ? t.season : null,
      episode: t.kind === 'episode' ? t.episode : null,
      episodeTitle: meta.episodeTitle,
      posterPath: meta.posterPath,
      fileName: basename(c.relPath.replace(/\\/g, '/')),
      sizeBytes: c.size,
      completedAt: c.job.completedAt,
      subtitles: [...new Set(subtitles)],
      available,
    };
  }

  private async exists(c: Candidate): Promise<boolean> {
    try {
      return (await stat(resolveInside(c.job.saveDir, c.relPath))).isFile();
    } catch {
      return false;
    }
  }

  /** Newest first. */
  async list(): Promise<LibraryItem[]> {
    const items = await Promise.all(this.candidates().map(async (c) => this.toItem(c, await this.exists(c))));
    return items.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0) || a.title.localeCompare(b.title, 'en'));
  }

  private candidate(id: string): Candidate {
    const ref = parseLibraryItemId(id);
    const c = ref && this.candidates().find((x) => x.job.id === ref.jobId && x.index === ref.fileIndex);
    if (!c) throw new AppError('NOT_FOUND');
    return c;
  }

  async get(id: string): Promise<LibraryItem> {
    const c = this.candidate(id);
    return this.toItem(c, await this.exists(c));
  }

  /**
   * The real file behind an item, for streaming or opening: no symlink/junction for the file, and its real path must
   * stay inside the real job folder (a folder swapped for a junction cannot redirect reads elsewhere).
   */
  async resolve(id: string): Promise<ResolvedLibraryFile> {
    const c = this.candidate(id);
    const full = resolveInside(c.job.saveDir, c.relPath);
    let real: string;
    let size: number;
    let mtimeMs: number;
    try {
      const link = await lstat(full);
      if (link.isSymbolicLink() || !link.isFile()) throw new AppError('FILE_MISSING');
      const [base, file] = await Promise.all([realpath(c.job.saveDir), realpath(full)]);
      if (!inside(base, file)) throw new AppError('FILE_MISSING');
      const s = await stat(file);
      real = file;
      size = s.size;
      mtimeMs = s.mtimeMs;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('FILE_MISSING');
    }
    const subtitles: { lang: string; path: string }[] = [];
    for (const task of this.deps.subtitles.list(c.job.id)) {
      if (task.fileIndex !== c.index || task.state !== 'ready' || !task.targetPath) continue;
      try {
        const sub = await realpath(task.targetPath);
        // Sidecars are written next to the video (D-62); anything else is ignored.
        if (dirname(sub) === dirname(real) && (await lstat(task.targetPath)).isFile())
          subtitles.push({ lang: task.lang, path: sub });
      } catch {
        /* subtitle file gone: the video still plays */
      }
    }
    return { item: this.toItem(c, true), path: real, size, mtimeMs, subtitles };
  }

  /** Desktop: opens the video in the default player. */
  async play(id: string): Promise<void> {
    const file = await this.resolve(id);
    const error = await this.deps.shell?.openPath(file.path);
    if (error) throw new AppError('FILE_MISSING', error);
  }

  async showInFolder(id: string): Promise<void> {
    const file = await this.resolve(id);
    this.deps.shell?.showItemInFolder(file.path);
  }

  /** Removes the download the item belongs to (files only when asked). */
  async remove(id: string, deleteFiles: boolean): Promise<void> {
    await this.deps.removeJob(this.candidate(id).job.id, deleteFiles);
  }
}
