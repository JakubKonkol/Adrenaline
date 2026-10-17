import { basename } from 'node:path';
import type { SubtitleTaskDto } from '@shared/contracts/downloads';
import type { RankedSubtitle, SubtitleCandidate } from '@shared/contracts/subtitles';
import { fileKind } from '@shared/domain/file-selection';
import { automaticSubtitle, rankSubtitles } from '@shared/domain/subtitle-ranking';
import { AppError } from '@shared/errors';
import { subtitleVideoPath, writeSubtitle } from '../fs/subtitle-sidecar';
import type { JobsRepository } from '../persistence/repositories/jobs';
import type { SubtitlesRepository } from '../persistence/repositories/subtitles';
import { movieHash } from '../providers/opensubtitles/movie-hash';
import type { SubtitleQuery } from '../providers/opensubtitles/opensubtitles-client';
import type { SubtitleClient } from './subtitle-providers';
import { validateSubtitle } from '../providers/opensubtitles/subtitle-file';

interface Deps {
  jobs: JobsRepository;
  tasks: SubtitlesRepository;
  client: SubtitleClient;
  changed: (jobId: string) => void;
  frameRate?: (video: string, size: number) => Promise<number | null>;
}

/** Independent of EngineSupervisor: retrying subtitles can never restart a movie download. */
export class SubtitleService {
  private running = new Map<number, Promise<void>>();
  private completed = new Set<string>();
  private cancelled = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private readonly deps: Deps) {}

  restore(): void {
    for (const job of this.deps.jobs.active()) {
      for (const task of this.deps.tasks.list(job.id)) {
        // A crash after POST /download may have spent quota. Require an explicit retry.
        if (task.state === 'downloading')
          this.deps.tasks.update(task.id, { state: 'error', errorCode: 'SUBS_UNAVAILABLE' });
        if (task.state === 'searching') this.deps.tasks.update(task.id, { state: 'pending' });
      }
      this.sync(job.id);
    }
  }

  sync(jobId: string): void {
    if (this.stopped || this.cancelled.has(jobId)) return;
    const job = this.deps.jobs.get(jobId);
    if (!job || job.state === 'removed') return;
    const files = this.deps.jobs.files(jobId).filter((f) => f.selected && fileKind(f.relPath) === 'video');
    let changed = false;
    for (const task of this.deps.tasks.list(jobId)) {
      if ((!job.subtitleLang || !files.some((f) => f.index === task.fileIndex)) && task.state !== 'disabled') {
        this.deps.tasks.update(task.id, { state: 'disabled' });
        changed = true;
      }
    }
    if (job.subtitleLang)
      for (const file of files) {
        const before = this.deps.tasks.list(jobId).find((t) => t.fileIndex === file.index);
        const task = this.deps.tasks.ensure(jobId, file.index, job.subtitleLang);
        if (!before) changed = true;
        if (task.state === 'disabled') {
          this.deps.tasks.update(task.id, { state: 'pending', lang: job.subtitleLang });
          task.state = 'pending';
          changed = true;
        }
        // A finished download paused by the user (e.g. while seeding) still has a complete video.
        if (
          ['downloaded', 'seeding', 'stopped', 'completed', 'paused'].includes(job.state) &&
          file.size > 0 &&
          file.doneBytes >= file.size
        )
          this.completed.add(`${jobId}:${file.index}`);
        if (task.state === 'pending' && this.completed.has(`${jobId}:${file.index}`)) this.enqueue(jobId, task);
      }
    if (changed) this.deps.changed(jobId);
  }

  complete(jobId: string, index: number): void {
    this.completed.add(`${jobId}:${index}`);
    this.sync(jobId);
  }

  async retry(jobId: string, taskId: number, fileId?: number): Promise<void> {
    const task = this.requireTask(jobId, taskId);
    if (this.running.has(taskId)) throw new AppError('BAD_REQUEST', 'subtitle task is busy');
    const candidate = fileId === undefined ? undefined : task.candidates.find((c) => c.fileId === fileId);
    if (fileId !== undefined && !candidate) throw new AppError('BAD_REQUEST');
    const file = this.deps.jobs.files(jobId).find((f) => f.index === task.fileIndex);
    if (!file?.selected || !this.completed.has(`${jobId}:${task.fileIndex}`))
      throw new AppError('BAD_REQUEST', 'video not complete');
    if (task.quotaResetAt && task.quotaResetAt > Date.now()) throw new AppError('SUBS_QUOTA');
    this.enqueue(jobId, task, candidate);
    await this.running.get(taskId);
  }

  async language(jobId: string, language: string | null, fallback: string | null): Promise<void> {
    const job = this.deps.jobs.get(jobId);
    if (!job || job.state === 'removed') throw new AppError('JOB_NOT_FOUND');
    await this.cancel(jobId);
    this.deps.jobs.update(jobId, { subtitleLang: language, subtitleFallbackLang: fallback });
    this.deps.jobs.update(jobId, {
      release: { ...job.release, subtitleChoice: undefined, subtitleProvider: undefined },
    });
    for (const task of this.deps.tasks.list(jobId))
      this.deps.tasks.update(task.id, {
        lang: language ?? task.lang,
        state: language ? 'pending' : 'disabled',
        candidates: [],
        errorCode: null,
        quotaResetAt: null,
      });
    this.cancelled.delete(jobId);
    this.sync(jobId);
    this.deps.changed(jobId);
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.add(jobId);
    const tasks = this.deps.tasks.list(jobId);
    await Promise.all(
      tasks.flatMap((t) => {
        const running = this.running.get(t.id);
        return running ? [running] : [];
      }),
    );
  }

  stop(): void {
    this.stopped = true;
  }
  async idle(): Promise<void> {
    await this.queue;
  }

  private requireTask(jobId: string, id: number): SubtitleTaskDto {
    const job = this.deps.jobs.get(jobId);
    const task = this.deps.tasks.list(jobId).find((t) => t.id === id);
    if (!job || job.state === 'removed' || !task) throw new AppError('JOB_NOT_FOUND');
    return task;
  }

  private enqueue(jobId: string, task: SubtitleTaskDto, candidate?: RankedSubtitle): void {
    if (this.running.has(task.id)) return;
    const run = this.queue
      .then(() => this.run(jobId, task, candidate))
      .finally(() => {
        this.running.delete(task.id);
      });
    this.running.set(task.id, run);
    this.queue = run;
  }

  private valid(jobId: string, task: SubtitleTaskDto): boolean {
    return (
      !this.stopped &&
      !this.cancelled.has(jobId) &&
      this.deps.jobs.get(jobId)?.state !== 'removed' &&
      this.deps.tasks.list(jobId).some((t) => t.id === task.id && t.state !== 'disabled')
    );
  }

  private async run(jobId: string, task: SubtitleTaskDto, chosen?: RankedSubtitle): Promise<void> {
    const update = (patch: Parameters<SubtitlesRepository['update']>[1]) => {
      if (!this.valid(jobId, task)) return;
      this.deps.tasks.update(task.id, patch);
      this.deps.changed(jobId);
    };
    try {
      if (!this.valid(jobId, task)) return;
      const job = this.deps.jobs.get(jobId)!;
      const file = this.deps.jobs.files(jobId).find((f) => f.index === task.fileIndex && f.selected);
      if (!file || !job.subtitleLang) return;
      update({ state: chosen ? 'downloading' : 'searching', errorCode: null, quotaResetAt: null });
      const video = await subtitleVideoPath(job.saveDir, file.relPath);
      if (!this.valid(jobId, task)) return;
      let selected = chosen ?? job.release.subtitleChoice ?? null;
      let language = selected?.language ?? job.subtitleLang;
      if (selected) update({ state: 'downloading', lang: language, candidates: [selected] });
      if (!selected) {
        const hash = await movieHash(video);
        if (!this.valid(jobId, task)) return;
        const target = job.target;
        const query: SubtitleQuery = {
          languages: [language],
          moviehash: hash,
          videoPath: video,
          query: job.target.originalTitle,
          provider: job.release.subtitleProvider,
          ...(target.kind === 'movie'
            ? { tmdbId: target.tmdbId }
            : { parentTmdbId: target.tmdbId, season: target.season, episode: target.episode }),
        };
        const matches = (c: SubtitleCandidate) =>
          c.language === language &&
          (!job.release.subtitleProvider || (c.provider ?? 'opensubtitles') === job.release.subtitleProvider);
        let results: SubtitleCandidate[];
        try {
          results = (await this.deps.client.search(query)).filter(matches);
        } catch (error) {
          if (!job.subtitleFallbackLang || job.subtitleFallbackLang === language) throw error;
          results = [];
        }
        if (!this.valid(jobId, task)) return;
        if (!results.length && job.subtitleFallbackLang && job.subtitleFallbackLang !== language) {
          language = job.subtitleFallbackLang;
          results = (await this.deps.client.search({ ...query, languages: [language] })).filter(matches);
          if (!this.valid(jobId, task)) return;
        }
        const candidates = rankSubtitles(results, basename(file.relPath));
        selected = automaticSubtitle(candidates);
        update({
          lang: language,
          candidates,
          state: !candidates.length ? 'not_found' : selected ? 'downloading' : 'needs_selection',
          errorCode: !candidates.length ? 'SUBS_NOT_FOUND' : null,
        });
        if (!selected) return;
      }
      if (!this.valid(jobId, task)) return;
      let data: Buffer;
      let fileName: string;
      if (this.deps.client.downloadCandidate) {
        ({ data, fileName } = await this.deps.client.downloadCandidate(selected, video));
      } else {
        const link = await this.deps.client.downloadLink(selected.fileId);
        if (!this.valid(jobId, task)) return;
        data = await this.deps.client.fetchFile(link.link);
        fileName = link.fileName;
      }
      if (!this.valid(jobId, task)) return;
      let subtitle = validateSubtitle(data, fileName, language);
      if (subtitle.extension === '.sub') {
        const fps =
          Number(/^\{[01]\}\{[01]\}(\d+(?:[.,]\d+)?)/m.exec(subtitle.text)?.[1]?.replace(',', '.')) ||
          (await this.deps.frameRate?.(video, file.size));
        if (fps) subtitle = validateSubtitle(data, fileName, language, fps);
      }
      await subtitleVideoPath(job.saveDir, file.relPath);
      if (!this.valid(jobId, task)) return;
      const targetPath = await writeSubtitle(video, language, subtitle.extension, subtitle.text);
      update({ state: 'ready', lang: language, targetPath, errorCode: null, quotaResetAt: null });
    } catch (error) {
      const fsCode = (error as NodeJS.ErrnoException).code;
      const code =
        error instanceof AppError
          ? error.code
          : fsCode === 'ENOSPC'
            ? 'DISK_FULL'
            : fsCode === 'ENOENT'
              ? 'FILE_MISSING'
              : fsCode === 'EACCES' || fsCode === 'EPERM'
                ? 'PATH_NOT_WRITABLE'
                : 'SUBS_UNAVAILABLE';
      const reset = error instanceof AppError ? error.details?.['resetAt'] : null;
      update({
        state: code === 'SUBS_QUOTA' ? 'quota_exceeded' : 'error',
        errorCode: code,
        quotaResetAt: typeof reset === 'number' ? reset : null,
      });
    }
  }
}
