import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rmdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DownloadJob, DownloadOptions, JobProgress, Preflight } from '@shared/contracts/downloads';
import type { EngineEvent, EngineState, JobStatus } from '@shared/contracts/engine';
import { fileKind, selectDefaultFiles } from '@shared/domain/file-selection';
import { parseMagnet } from '@shared/domain/magnet';
import type { SearchTarget } from '@shared/domain/search-target';
import { ACTIVE_STATES, canTransition, ENGINE_STATES, type JobState, type PauseReason } from '@shared/domain/job-state';
import { AppError } from '@shared/errors';
import { mapEngineErrorCode } from '../engine/error-map';
import type { EngineSupervisor } from '../engine/engine-process';
import { checkWritable, freeBytesNear, requiredSpace } from '../fs/disk-space';
import { jobFolder, numberedVariant } from '../fs/job-folder';
import { isPathTooLong, resolveInside } from '../fs/safe-path';
import type { Logger } from '../logger';
import type { JobRow, JobsRepository } from '../persistence/repositories/jobs';
import type { SubtitlesRepository } from '../persistence/repositories/subtitles';
import { readBodyLimited } from '../providers/http';
import { isAllowedDownloadUrl } from '../providers/torznab/torznab-client';
import { Emitter } from '../util/emitter';
import type { ReleaseDownloadInfo } from './release-search-service';
import type { SettingsService } from './settings-service';

const MAX_TORRENT_BYTES = 10 * 1024 * 1024;
const PROGRESS_SAVE_MS = 30_000;
const ENGINE_LEVEL_ERRORS: readonly string[] = ['ENGINE_CRASHED', 'ENGINE_UNAVAILABLE', 'ENGINE_TIMEOUT'];

export interface DownloadServiceDeps {
  jobs: JobsRepository;
  engine: EngineSupervisor;
  settings: SettingsService;
  /** Release chosen on the releases screen (links stay in main). */
  releaseInfo: (sessionId: string, releaseId: string) => ReleaseDownloadInfo | null;
  /** Torznab endpoint of a source, for the SSRF rule on result links. */
  endpointFor: (sourceId: string) => Promise<string | null>;
  log: Logger;
  fetch?: typeof fetch;
  shell?: { showItemInFolder(path: string): void; openPath(path: string): Promise<string> };
  now?: () => number;
  subtitles?: SubtitlesRepository;
  beforeRemove?: (jobId: string) => Promise<void>;
}

export type DownloadEvents = {
  changed: DownloadJob;
  progress: { jobs: JobProgress[] };
  /** A selected file finished (etap 7 starts subtitles). */
  fileCompleted: { jobId: string; index: number };
};

type Ref = { sessionId: string; releaseId: string };

/**
 * Download jobs (etap 6): SQLite is the source of truth; the engine is told what to do. Main runs the queue (D-43):
 * at most `maxActiveDownloads` jobs fetch metadata, download or check at once.
 * D-80: once every selected file is verified on disk the torrent is removed from the engine (no seeding) and the job
 * becomes `completed`; the files stay where they are and the job shows up in the library.
 */
export class DownloadService extends Emitter<DownloadEvents> {
  private inEngine = new Set<string>();
  private progress = new Map<string, JobProgress>();
  private lastSave = new Map<string, number>();
  private scheduling = false;
  /** Engine events are handled one at a time, in order (a handler may await engine requests). */
  private eventChain: Promise<void> = Promise.resolve();

  constructor(private readonly deps: DownloadServiceDeps) {
    super();
    deps.engine.on('event', (e) => {
      this.eventChain = this.eventChain
        .then(() => this.onEngineEvent(e))
        .catch((err: unknown) => deps.log.error('engine event', err));
    });
    deps.engine.on(
      'ready',
      () => void this.onEngineReady().catch((err: unknown) => deps.log.error('restore jobs', err)),
    );
    deps.engine.on('status', (s) => {
      if (s.state === 'restarting' || s.state === 'crashed') this.markStale();
    });
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  // ---------------------------------------------------------------- DTOs

  toDto(job: JobRow): DownloadJob {
    return {
      id: job.id,
      target: job.target,
      releaseName: job.release.name,
      sources: job.release.sources,
      state: job.state,
      pauseReason: job.pauseReason,
      errorCode: job.errorCode,
      saveDir: job.saveDir,
      files: this.deps.jobs.files(job.id).map((f) => ({
        index: f.index,
        path: f.relPath,
        size: f.size,
        selected: f.selected,
        doneBytes: this.progress.get(job.id)?.files.find((p) => p.index === f.index)?.doneBytes ?? f.doneBytes,
        kind: fileKind(f.relPath),
      })),
      suggestedFiles: job.release.suggestedFiles,
      totalBytes: job.totalBytes,
      infoHashV1: job.infoHashV1,
      infoHashV2: job.infoHashV2,
      seedRatioLimit: job.seedRatioLimit,
      seedTimeLimitMin: job.seedTimeLimitMin,
      subtitleLang: job.subtitleLang,
      subtitleFallbackLang: job.subtitleFallbackLang,
      subtitles: this.deps.subtitles?.list(job.id) ?? [],
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  }

  list(): DownloadJob[] {
    return this.deps.jobs.active().map((j) => this.toDto(j));
  }

  get(id: string): DownloadJob {
    return this.toDto(this.require(id));
  }

  progressSnapshot(): JobProgress[] {
    return [...this.progress.values()];
  }

  private require(id: string): JobRow {
    const job = this.deps.jobs.get(id);
    if (!job || job.state === 'removed') throw new AppError('JOB_NOT_FOUND');
    return job;
  }

  emitJob(id: string) {
    const job = this.deps.jobs.get(id);
    if (job) this.emit('changed', this.toDto(job));
  }

  private setState(job: JobRow, state: JobState, extra: Partial<JobRow> = {}): JobRow {
    if (!canTransition(job.state, state)) {
      this.deps.log.warn(`ignored transition ${job.state} → ${state} for ${job.id}`);
      return job;
    }
    this.deps.jobs.update(job.id, { state, ...extra });
    const next = this.deps.jobs.get(job.id)!;
    this.emit('changed', this.toDto(next));
    return next;
  }

  // ---------------------------------------------------------------- creation

  private info(ref: Ref): ReleaseDownloadInfo {
    const info = this.deps.releaseInfo(ref.sessionId, ref.releaseId);
    if (!info) throw new AppError('NOT_FOUND', 'release no longer available, search again');
    return info;
  }

  private async plan(ref: Ref, options: Pick<DownloadOptions, 'saveDir' | 'renameOnConflict'>) {
    const { release, target } = this.info(ref);
    const base = options.saveDir ?? this.deps.settings.get().downloadDir;
    let folder = jobFolder(base, target, release.name);
    const folderExists = await isNonEmptyDir(folder);
    if (folderExists && options.renameOnConflict) {
      for (let n = 2; n < 100; n++) {
        const candidate = numberedVariant(folder, n);
        if (!(await isNonEmptyDir(candidate))) {
          folder = candidate;
          break;
        }
      }
    }
    return { release, target, base, folder, folderExists };
  }

  /** Checks before "Pobierz" (FR07, BR07): writable folder, free space, conflicts, duplicates, path length. */
  async preflight(ref: Ref, options: Pick<DownloadOptions, 'saveDir' | 'renameOnConflict'> = {}): Promise<Preflight> {
    const { release, base, folder, folderExists } = await this.plan(ref, options);
    let writable = true;
    try {
      await checkWritable(base);
    } catch {
      writable = false;
    }
    const free = await freeBytesNear(base);
    const required = release.size !== null ? requiredSpace(release.size) : null;
    const duplicate = this.deps.jobs.findByHash(release.infoHashV1, release.infoHashV2);
    return {
      folder,
      sizeBytes: release.size,
      freeBytes: free,
      requiredBytes: required,
      enoughSpace: free !== null && required !== null ? free >= required : null,
      writable,
      folderExists: folderExists && !options.renameOnConflict,
      pathTooLong: isPathTooLong(folder),
      duplicateJobId: duplicate?.id ?? null,
      hasFileList: false,
    };
  }

  async create(ref: Ref, options: DownloadOptions): Promise<DownloadJob> {
    const { release, target, base, folder, folderExists } = await this.plan(ref, options);
    const duplicate = this.deps.jobs.findByHash(release.infoHashV1, release.infoHashV2);
    if (duplicate) throw new AppError('DUPLICATE_JOB', duplicate.id, { jobId: duplicate.id });
    await checkWritable(base);
    if (folderExists && !options.renameOnConflict) throw new AppError('PATH_CONFLICT', folder);
    if (release.size !== null) {
      const free = await freeBytesNear(base);
      if (free !== null && free < requiredSpace(release.size)) {
        throw new AppError('DISK_FULL', 'not enough space', { free, required: requiredSpace(release.size) });
      }
    }
    const source = await this.obtainTorrent(release);
    const now = this.now();
    const job: JobRow = {
      id: randomUUID(),
      mediaItemId: null,
      episodeId: null,
      target,
      release: {
        name: release.name,
        sources: [...new Set(release.hits.map((h) => h.sourceName))],
        size: release.size,
        suggestedFiles: [],
      },
      sourceKind: source.magnet ? 'magnet' : 'torrent',
      magnet: source.magnet,
      torrent: source.torrent,
      infoHashV1: release.infoHashV1,
      infoHashV2: release.infoHashV2,
      saveDir: folder,
      state: 'queued',
      pauseReason: null,
      resumeState: null,
      errorCode: null,
      errorMessage: null,
      totalBytes: release.size,
      doneBytes: 0,
      seedRatioLimit: options.seedRatioLimit,
      seedTimeLimitMin: options.seedTimeLimitMin,
      subtitleLang: options.subtitleLang,
      subtitleFallbackLang: options.subtitleLang ? options.subtitleFallbackLang : null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    try {
      this.deps.jobs.insert(job);
    } catch {
      throw new AppError('DUPLICATE_JOB');
    }
    this.emitJob(job.id);
    await this.schedule();
    return this.get(job.id);
  }

  /** Dev/test only (fake engine): a job straight from a magnet, with default options from Settings. */
  async createDirect(target: SearchTarget, magnet: string, name: string): Promise<DownloadJob> {
    const s = this.deps.settings.get();
    const now = this.now();
    const info = parseMagnet(magnet);
    const job: JobRow = {
      id: randomUUID(),
      mediaItemId: null,
      episodeId: null,
      target,
      release: { name, sources: ['test'], size: null, suggestedFiles: [] },
      sourceKind: 'magnet',
      magnet,
      torrent: null,
      infoHashV1: info?.infoHashV1 ?? null,
      infoHashV2: info?.infoHashV2 ?? null,
      saveDir: jobFolder(s.downloadDir, target, name),
      state: 'queued',
      pauseReason: null,
      resumeState: null,
      errorCode: null,
      errorMessage: null,
      totalBytes: null,
      doneBytes: 0,
      seedRatioLimit: s.seedRatioLimit,
      seedTimeLimitMin: s.seedTimeLimitMin,
      subtitleLang: s.subtitlesEnabled ? s.subtitleLang : null,
      subtitleFallbackLang: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };
    if (this.deps.jobs.findByHash(job.infoHashV1, null)) throw new AppError('DUPLICATE_JOB');
    this.deps.jobs.insert(job);
    this.emitJob(job.id);
    await this.schedule();
    return this.get(job.id);
  }

  /** Magnet when any source has one; otherwise the .torrent from the source host only (SSRF rule, 5.3). */
  private async obtainTorrent(
    release: ReleaseDownloadInfo['release'],
  ): Promise<{ magnet: string | null; torrent: Uint8Array | null }> {
    const withMagnet = release.hits.find((h) => h.magnet);
    if (withMagnet?.magnet) return { magnet: withMagnet.magnet, torrent: null };
    const byLink = [...release.hits].filter((h) => h.link).sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
    let lastError: unknown = new AppError('INVALID_TORRENT', 'no download link');
    for (const hit of byLink) {
      try {
        const endpoint = await this.deps.endpointFor(hit.sourceId);
        if (!endpoint) continue;
        return await this.fetchTorrent(hit.link!, endpoint);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof AppError ? lastError : new AppError('INVALID_TORRENT');
  }

  private async fetchTorrent(
    link: string,
    endpoint: string,
  ): Promise<{ magnet: string | null; torrent: Uint8Array | null }> {
    let url = link;
    for (let hop = 0; hop < 4; hop++) {
      if (/^magnet:\?/i.test(url)) return { magnet: url, torrent: null };
      if (!isAllowedDownloadUrl(url, endpoint)) throw new AppError('INVALID_TORRENT', 'link outside the source');
      let res: Response;
      try {
        res = await (this.deps.fetch ?? fetch)(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      } catch {
        throw new AppError('SOURCE_UNAVAILABLE');
      }
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel();
        const location = res.headers.get('Location');
        if (!location) throw new AppError('INVALID_TORRENT', 'redirect without location');
        url = /^magnet:/i.test(location) ? location : new URL(location, url).toString();
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new AppError('SOURCE_UNAVAILABLE', `HTTP ${res.status}`);
      }
      const body = await readBodyLimited(res, MAX_TORRENT_BYTES);
      if (!body) throw new AppError('TORRENT_TOO_LARGE');
      if (body[0] !== 0x64 /* "d": bencoded dictionary */) throw new AppError('INVALID_TORRENT');
      return { magnet: null, torrent: new Uint8Array(body) };
    }
    throw new AppError('INVALID_TORRENT', 'too many redirects');
  }

  // ---------------------------------------------------------------- queue and engine

  private get engineRunning() {
    return this.deps.engine.status.state === 'running';
  }

  /** Starts queued jobs while slots are free (oldest first). */
  async schedule(): Promise<void> {
    if (this.scheduling || !this.engineRunning) return;
    this.scheduling = true;
    try {
      const max = this.deps.settings.get().maxActiveDownloads;
      for (;;) {
        const all = this.deps.jobs.active();
        const active = all.filter((j) => ACTIVE_STATES.includes(j.state)).length;
        const next = all.find((j) => j.state === 'queued');
        if (!next || active >= max) break;
        await this.startInEngine(next, false);
      }
    } finally {
      this.scheduling = false;
    }
  }

  private async startInEngine(job: JobRow, paused: boolean): Promise<void> {
    try {
      const added = await this.deps.engine.request(
        'add',
        {
          ...(job.magnet
            ? { magnet: job.magnet }
            : { torrentBase64: Buffer.from(job.torrent ?? []).toString('base64') }),
          savePath: job.saveDir,
          paused,
        },
        job.id,
      );
      this.inEngine.add(job.id);
      const v1 = added.infoHashV1 || null;
      const v2 = added.infoHashV2 || null;
      const dup = this.deps.jobs.findByHash(v1, v2);
      if (dup && dup.id !== job.id) {
        await this.deps.engine.request('remove', { deleteFiles: false }, job.id).catch(() => undefined);
        this.inEngine.delete(job.id);
        this.setState(job, 'error', { errorCode: 'DUPLICATE_JOB', resumeState: null });
        return;
      }
      this.deps.jobs.update(job.id, { infoHashV1: v1 ?? job.infoHashV1, infoHashV2: v2 ?? job.infoHashV2 });
      await this.deps.engine.request(
        'setSeedPolicy',
        { ratio: job.seedRatioLimit, minutes: job.seedTimeLimitMin },
        job.id,
      );
      // Restart: the selection lives in SQLite and is sent again once the engine knows the files (right away
      // with resume data or a .torrent, otherwise on the `metadata` event of the magnet).
      if (added.hasMetadata) await this.resendSelection(job.id);
      if (job.state === 'queued') {
        const fresh = this.deps.jobs.get(job.id)!;
        if (fresh.state === 'queued') this.setState(fresh, added.hasMetadata ? 'downloading' : 'fetching_metadata');
      }
    } catch (error) {
      const code =
        error instanceof AppError
          ? error.code
          : mapEngineErrorCode((error as { engineCode?: string }).engineCode ?? 'INTERNAL');
      this.deps.log.warn(`could not start ${job.id}: ${code}`);
      // The engine itself went away (crash, restart): the job is fine and is added again on the next start.
      if (ENGINE_LEVEL_ERRORS.includes(code)) return;
      const fresh = this.deps.jobs.get(job.id);
      if (fresh)
        this.setState(fresh, 'error', {
          errorCode: code,
          resumeState: fresh.state === 'error' ? fresh.resumeState : fresh.state,
        });
    }
  }

  /** After the engine (re)started: every job that lived in the engine is added again with the same jobId. */
  private async onEngineReady(): Promise<void> {
    this.inEngine.clear();
    for (const job of this.deps.jobs.active()) {
      // D-80: finished jobs are never added again (profiles from 0.9.0 kept them seeding).
      if (this.isFinished(job)) {
        this.complete(job);
        continue;
      }
      if (!ENGINE_STATES.includes(job.state) && job.state !== 'error') continue;
      if (job.state === 'error' && !job.resumeState) continue;
      const paused = job.state === 'paused' || job.state === 'stopped' || job.state === 'error';
      await this.startInEngine(job, paused);
    }
    await this.applyLimitsFromSettings();
    await this.schedule();
  }

  async applyLimitsFromSettings(): Promise<void> {
    const s = this.deps.settings.get();
    await this.deps.engine
      .request('setLimits', { downloadBps: s.downloadLimitKBps * 1024, uploadBps: s.uploadLimitKBps * 1024 })
      .catch((e: unknown) => this.deps.log.warn('setLimits failed', e));
  }

  /** Files complete: a finished state, or a paused job whose selected files are all on disk (paused seeding). */
  private isFinished(job: JobRow): boolean {
    if (job.state === 'downloaded' || job.state === 'seeding' || job.state === 'stopped') return true;
    if (job.state !== 'paused') return false;
    const selected = this.deps.jobs.files(job.id).filter((f) => f.selected);
    return selected.length > 0 && selected.every((f) => f.size > 0 && f.doneBytes >= f.size);
  }

  private complete(job: JobRow): void {
    this.progress.delete(job.id);
    this.setState(job, 'completed', { pauseReason: null, errorCode: null, completedAt: job.completedAt ?? this.now() });
  }

  /** D-80: stop sharing a finished torrent: remove it from the engine (resume data too), keep the files. */
  private async release(jobId: string): Promise<void> {
    try {
      await this.deps.engine.request('remove', { deleteFiles: false }, jobId, { timeoutMs: 15_000 });
      this.inEngine.delete(jobId);
    } catch (error) {
      // The engine went away: the job stays `downloaded` and is completed (not re-added) on the next engine start.
      this.deps.log.warn(`could not release ${jobId} from the engine`, error);
      return;
    }
    const job = this.deps.jobs.get(jobId);
    if (job && job.state !== 'removed') this.complete(job);
  }

  private markStale() {
    const stale = [...this.progress.values()].map((p) => ({ ...p, live: false, downloadRate: 0, uploadRate: 0 }));
    for (const p of stale) this.progress.set(p.jobId, p);
    if (stale.length) this.emit('progress', { jobs: stale });
  }

  private async onEngineEvent(event: EngineEvent): Promise<void> {
    switch (event.event) {
      case 'metadata':
        return this.onMetadata(event.data);
      case 'state':
        return this.onEngineState(event.data.jobId, event.data.state, event.data.reason, event.data.error);
      case 'progress':
        return this.onProgress(event.data.jobs);
      case 'fileCompleted':
        this.emit('fileCompleted', event.data);
        return;
      default:
        return;
    }
  }

  private async onMetadata(data: Extract<EngineEvent, { event: 'metadata' }>['data']): Promise<void> {
    const job = this.deps.jobs.get(data.jobId);
    if (!job || job.state === 'removed') return;
    this.deps.jobs.update(job.id, {
      infoHashV1: data.infoHashV1 || job.infoHashV1,
      infoHashV2: data.infoHashV2 || job.infoHashV2,
      totalBytes: data.totalSize,
    });
    if (this.deps.jobs.files(job.id).length > 0) {
      await this.resendSelection(job.id); // known from an earlier run
      return;
    }
    const files = data.files.filter((f) => !f.pad);
    // NFR06: every path must stay inside the job folder; otherwise nothing is downloaded.
    try {
      for (const f of files) resolveInside(job.saveDir, f.path);
    } catch {
      await this.deps.engine.request('remove', { deleteFiles: false }, job.id).catch(() => undefined);
      this.inEngine.delete(job.id);
      this.setState(job, 'error', { errorCode: 'UNSAFE_TORRENT_PATH', resumeState: null });
      return;
    }
    this.deps.jobs.replaceFiles(
      job.id,
      files.map((f) => ({ index: f.index, relPath: f.path, size: f.size, selected: false, doneBytes: 0 })),
    );
    const choice = selectDefaultFiles(files, job.target);
    if (!choice.ambiguous && choice.selected.length > 0) {
      await this.applySelection(this.deps.jobs.get(job.id)!, choice.selected);
    } else {
      this.deps.jobs.update(job.id, { release: { ...job.release, suggestedFiles: choice.selected } });
      this.setState(this.deps.jobs.get(job.id)!, 'awaiting_file_selection');
    }
  }

  private async resendSelection(jobId: string): Promise<void> {
    const selected = this.deps.jobs.files(jobId).filter((f) => f.selected);
    if (selected.length === 0) return;
    await this.deps.engine.request(
      'selectFiles',
      { files: selected.map((f) => ({ index: f.index, priority: 4 })) },
      jobId,
    );
  }

  private async applySelection(job: JobRow, indices: number[]): Promise<void> {
    const files = this.deps.jobs.files(job.id);
    const size = files.filter((f) => indices.includes(f.index)).reduce((a, f) => a + f.size, 0);
    const free = await freeBytesNear(job.saveDir);
    this.deps.jobs.setSelection(job.id, indices);
    await this.deps.engine.request('selectFiles', { files: indices.map((index) => ({ index, priority: 4 })) }, job.id);
    if (free !== null && free < requiredSpace(size)) {
      await this.deps.engine.request('pause', {}, job.id).catch(() => undefined);
      this.setState(this.deps.jobs.get(job.id)!, 'paused', { pauseReason: 'disk_full', errorCode: 'DISK_FULL' });
      return;
    }
    const fresh = this.deps.jobs.get(job.id)!;
    if (fresh.state === 'awaiting_file_selection' || fresh.state === 'fetching_metadata' || fresh.state === 'queued') {
      this.setState(fresh, 'downloading');
    } else {
      this.emitJob(job.id); // the selection changed even if the state did not
    }
  }

  private async onEngineState(
    jobId: string,
    state: EngineState,
    reason: string | undefined,
    error: { code: string; message: string } | undefined,
  ): Promise<void> {
    const job = this.deps.jobs.get(jobId);
    if (!job || job.state === 'removed' || job.state === 'completed') return;
    switch (state) {
      case 'fetching_metadata':
        if (job.state === 'queued') this.setState(job, 'fetching_metadata');
        break;
      case 'downloading':
        // Before the files are chosen the engine "downloads" nothing; keep waiting for the user.
        if (job.state === 'awaiting_file_selection' || job.state === 'paused' || job.state === 'stopped') break;
        if (job.state === 'fetching_metadata' && this.deps.jobs.files(job.id).length === 0) break;
        this.setState(job, 'downloading', { errorCode: null });
        break;
      case 'checking':
        if (job.state !== 'paused') this.setState(job, 'checking');
        break;
      case 'paused': {
        // A job in error is added paused on restore; the engine's "paused" must not turn it into a user pause.
        if (job.state === 'error') break;
        const pauseReason: PauseReason =
          reason === 'disk_full'
            ? 'disk_full'
            : reason === 'disk_missing' || reason === 'disk_error'
              ? 'disk_missing'
              : (job.pauseReason ?? 'user');
        const errorCode =
          reason === 'disk_full' ? 'DISK_FULL' : pauseReason === 'disk_missing' ? 'DISK_MISSING' : job.errorCode;
        this.setState(job, 'paused', { pauseReason, errorCode });
        break;
      }
      case 'downloaded':
        this.persistProgress(jobId, true);
        this.setState(job, 'downloaded', { completedAt: job.completedAt ?? this.now(), errorCode: null });
        await this.release(jobId);
        break;
      case 'seeding':
        // Normally the job is released on `downloaded`; a seeding torrent left in the engine is released here.
        if (job.state === 'paused') break;
        await this.release(jobId);
        break;
      case 'stopped':
        await this.release(jobId);
        break;
      case 'error':
        this.setState(job, 'error', {
          errorCode: mapEngineErrorCode(error?.code ?? 'INTERNAL', reason),
          resumeState: job.state === 'error' ? job.resumeState : job.state,
        });
        break;
    }
    await this.schedule();
  }

  private onProgress(statuses: JobStatus[]) {
    const out: JobProgress[] = [];
    for (const s of statuses) {
      const p: JobProgress = {
        jobId: s.jobId,
        selectedBytes: s.selectedBytes,
        selectedDoneBytes: s.selectedDoneBytes,
        files: s.files,
        downloadRate: s.downloadRate,
        uploadRate: s.uploadRate,
        peers: s.peers,
        seeds: s.seeds,
        ratio: s.ratio,
        seedingSeconds: s.seedingSeconds,
        etaSeconds: s.etaSeconds,
        live: true,
      };
      this.progress.set(s.jobId, p);
      out.push(p);
      this.persistProgress(s.jobId, false);
    }
    if (out.length) this.emit('progress', { jobs: out });
  }

  /** done_bytes is written every 30 s and on state changes (01-architektura.md). */
  private persistProgress(jobId: string, force: boolean) {
    const p = this.progress.get(jobId);
    if (!p) return;
    const last = this.lastSave.get(jobId) ?? 0;
    if (!force && this.now() - last < PROGRESS_SAVE_MS) return;
    this.lastSave.set(jobId, this.now());
    this.deps.jobs.saveProgress(jobId, p.selectedDoneBytes, p.files);
  }

  /** Called on quit: last progress into SQLite. */
  persistAll(): void {
    for (const id of this.progress.keys()) this.persistProgress(id, true);
  }

  // ---------------------------------------------------------------- user actions

  async selectFiles(jobId: string, indices: number[]): Promise<DownloadJob> {
    const job = this.require(jobId);
    const files = this.deps.jobs.files(jobId);
    const unique = [...new Set(indices)];
    if (unique.length === 0 || unique.some((i) => !files.some((f) => f.index === i))) {
      throw new AppError('BAD_REQUEST', 'unknown file');
    }
    if (!this.inEngine.has(jobId)) throw new AppError('ENGINE_UNAVAILABLE');
    await this.applySelection(job, unique);
    return this.get(jobId);
  }

  /** FR11: the state becomes "paused" only after the engine confirmed the pause. */
  async pause(jobId: string): Promise<DownloadJob> {
    const job = this.require(jobId);
    if (job.state === 'paused' || job.state === 'completed') return this.toDto(job);
    if (!this.inEngine.has(jobId)) {
      this.setState(job, 'paused', { pauseReason: 'user' });
      return this.get(jobId);
    }
    await this.deps.engine.request('pause', {}, jobId);
    this.setState(this.deps.jobs.get(jobId)!, 'paused', { pauseReason: 'user' });
    await this.schedule();
    return this.get(jobId);
  }

  async resume(jobId: string): Promise<DownloadJob> {
    const job = this.require(jobId);
    if (!['paused', 'error', 'stopped'].includes(job.state)) return this.toDto(job);
    if (!this.inEngine.has(jobId)) {
      this.setState(job, 'queued', { pauseReason: null, errorCode: null });
      await this.schedule();
      return this.get(jobId);
    }
    if (job.state === 'stopped') {
      // Explicit resume of seeding: no limits until the user stops it again.
      await this.deps.engine.request('setSeedPolicy', { ratio: null, minutes: null }, jobId);
    }
    const result = await this.deps.engine.request('resume', {}, jobId);
    const files = this.deps.jobs.files(jobId);
    const selected = files.filter((f) => f.selected);
    let next: JobState =
      job.state === 'error' && job.resumeState
        ? job.resumeState
        : result.state === 'seeding'
          ? 'seeding'
          : result.state === 'checking'
            ? 'checking'
            : result.state === 'fetching_metadata'
              ? 'fetching_metadata'
              : 'downloading';
    if (files.length > 0 && selected.length === 0) next = 'awaiting_file_selection';
    if (next === 'paused') next = 'downloading';
    this.setState(this.deps.jobs.get(jobId)!, next, { pauseReason: null, errorCode: null, resumeState: null });
    await this.schedule();
    return this.get(jobId);
  }

  /** FR13: by default files stay; with deleteFiles only this job's files are removed, then empty folders. */
  async remove(jobId: string, deleteFiles: boolean): Promise<void> {
    const job = this.require(jobId);
    await this.deps.beforeRemove?.(jobId);
    if (this.inEngine.has(jobId)) {
      await this.deps.engine.request('remove', { deleteFiles }, jobId, { timeoutMs: 15_000 });
      this.inEngine.delete(jobId);
    }
    this.progress.delete(jobId);
    this.setState(job, 'removed');
    if (deleteFiles) await removeEmptyDirs(job.saveDir, this.deps.settings.get().downloadDir);
    await this.schedule();
  }

  /** FR21: shows the film in Explorer; FILE_MISSING when the files or the drive are gone. */
  async openFolder(jobId: string): Promise<void> {
    const job = this.require(jobId);
    const shell = this.deps.shell;
    if (!shell) return;
    const files = this.deps.jobs.files(jobId).filter((f) => f.selected);
    for (const f of files) {
      const full = resolveInside(job.saveDir, f.relPath);
      if (existsSync(full)) {
        shell.showItemInFolder(full);
        return;
      }
    }
    if (existsSync(job.saveDir)) {
      await shell.openPath(job.saveDir);
      return;
    }
    throw new AppError('FILE_MISSING');
  }

  async recheck(jobId: string): Promise<DownloadJob> {
    this.require(jobId);
    if (!this.inEngine.has(jobId)) throw new AppError('ENGINE_UNAVAILABLE');
    await this.deps.engine.request('recheck', {}, jobId);
    return this.get(jobId);
  }

  async pauseAll(): Promise<void> {
    for (const job of this.deps.jobs.active()) {
      if (
        ['queued', 'fetching_metadata', 'awaiting_file_selection', 'downloading', 'checking', 'seeding'].includes(
          job.state,
        )
      ) {
        await this.pause(job.id).catch((e: unknown) => this.deps.log.warn('pause failed', e));
      }
    }
  }

  async resumeAll(): Promise<void> {
    for (const job of this.deps.jobs.active()) {
      if (job.state === 'paused' && job.pauseReason === 'user') {
        await this.resume(job.id).catch((e: unknown) => this.deps.log.warn('resume failed', e));
      }
    }
  }

  /** Tray tooltip: total speeds. */
  totals(): { down: number; up: number; active: number } {
    let down = 0;
    let up = 0;
    for (const p of this.progress.values()) {
      if (!p.live) continue;
      down += p.downloadRate;
      up += p.uploadRate;
    }
    const active = this.deps.jobs
      .active()
      .filter((j) => ACTIVE_STATES.includes(j.state) || j.state === 'awaiting_file_selection').length;
    return { down, up, active };
  }
}

async function isNonEmptyDir(dir: string): Promise<boolean> {
  try {
    if (!(await stat(dir)).isDirectory()) return true;
    return (await readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

/** Removes the job folder and its empty parents, never going above the download base folder. */
async function removeEmptyDirs(dir: string, base: string): Promise<void> {
  let current = dir;
  for (let i = 0; i < 4; i++) {
    if (current.length <= base.length || !current.startsWith(base)) return;
    try {
      await rmdir(current);
    } catch {
      return; // not empty or gone
    }
    current = dirname(current);
  }
}
