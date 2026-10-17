import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { PlaybackPlan } from '@shared/domain/playback';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import {
  buildHlsArgs,
  BURN_IN_FILE,
  extractAssArgs,
  SEGMENT_LIST,
  SEGMENT_SECONDS,
  segmentName,
  vodPlaylist,
} from './ffmpeg-args';

export interface TranscodeRequest {
  deviceId: string;
  itemId: string;
  input: string;
  plan: PlaybackPlan;
  durationMs: number;
  /** Segment start times (ms): keyframes of the file for a copy, even steps for an encode (keyframes.ts). */
  starts: number[];
  /** Where the TV will start: FFmpeg begins with that segment, before the TV asks. */
  startMs: number;
}

export interface TranscodeSession {
  id: string;
  deviceId: string;
  itemId: string;
  plan: PlaybackPlan;
  durationMs: number;
  starts: number[];
  dir: string;
  startedAt: number;
  lastAccess: number;
  /** Segment the player asked for last (segments far behind it can be pruned). */
  lastSegment: number;
  /** First segment of the running FFmpeg; null when none runs (paused ahead, idle, finished). */
  runningFrom: number | null;
  /** FFmpeg speed (×realtime) from `-progress`, for diagnostics. */
  speed: number | null;
  exitCode: number | null;
  /** The last FFmpeg run reached the end of the film. */
  finished: boolean;
}

export interface ProcessHandle {
  pid: number | undefined;
  onExit(listener: (code: number | null) => void): void;
  onProgress(listener: (key: string, value: string) => void): void;
  kill(): void;
}

export type FfmpegSpawner = (args: string[], cwd: string) => ProcessHandle;

/** Kills FFmpeg and anything it started (Windows: the whole process tree). */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  } else {
    child.kill('SIGKILL');
  }
}

export function spawnFfmpeg(ffmpeg: string): FfmpegSpawner {
  return (args, cwd) => {
    const child = spawn(ffmpeg, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const progress: ((k: string, v: string) => void)[] = [];
    createInterface({ input: child.stdout }).on('line', (line) => {
      const i = line.indexOf('=');
      if (i > 0) for (const l of progress) l(line.slice(0, i), line.slice(i + 1).trim());
    });
    child.stderr.resume();
    return {
      pid: child.pid,
      onExit: (l) => void child.on('exit', (code) => l(code)),
      onProgress: (l) => void progress.push(l),
      kill: () => killTree(child),
    };
  };
}

export interface TranscoderOptions {
  /** userData/transcode: emptied on start and quit. */
  cacheDir: string;
  spawn: FfmpegSpawner;
  /** Extracts text subtitles for burn-in (ffmpeg run to completion). */
  runFfmpeg: (args: string[], cwd: string) => Promise<void>;
  log: Logger;
  /** Disk limit for all sessions (bytes). */
  cacheLimitBytes: () => number;
  /** No request for this long: FFmpeg stops (the session stays, a later segment starts it again). */
  idleMs?: number;
  /** No request for this long: the session and its folder are deleted. */
  sessionTtlMs?: number;
  now?: () => number;
}

/** Number of a segment file name (`seg00042.ts` → 42). */
export function segmentNumber(name: string): number | null {
  const m = /^seg(\d{5})\.ts$/.exec(name);
  return m ? Number(m[1]) : null;
}

/** A segment this far past what FFmpeg wrote restarts it there (Jellyfin: 24 s). */
const RESTART_GAP = Math.ceil(24 / SEGMENT_SECONDS);
/** FFmpeg stops this far ahead of the player (hard limit of the forward buffer)… */
const MAX_AHEAD = Math.ceil(300 / SEGMENT_SECONDS);
/** …and starts again when the player gets this close to the end of what exists. */
const RESUME_AHEAD = Math.ceil(120 / SEGMENT_SECONDS);
/** Segments this far behind the player go first when the cache is over its limit. */
const KEEP_BEHIND = 10;
/** Runs of one segment that failed in a row before the TV gets an error. */
const MAX_FAILURES = 2;

type Live = TranscodeSession & {
  input: string;
  /** Segments FFmpeg finished (from its segment lists). */
  done: Set<number>;
  /** Last segment the running FFmpeg finished (runningFrom − 1 before the first): the next one is being written. */
  runLast: number;
  proc: ProcessHandle | null;
  /** Resolves when the killed process has exited (files are free again). */
  exited: Promise<void>;
  starting: Promise<void> | null;
  failures: number;
  imageSubtitleIndex: number | null;
  textSubtitleFile: boolean;
};

/**
 * HLS sessions (D-85), in the style of Jellyfin: the TV gets a VOD playlist of the whole film and FFmpeg writes the
 * segments from where the TV plays. A segment far from what FFmpeg is writing (a seek) restarts FFmpeg at that
 * segment; FFmpeg stops 5 minutes ahead of the player and when the TV is idle (pause), and starts again on demand, so
 * neither a long pause nor a fast copy breaks playback or fills the disk. At most one session encodes video at a
 * time. Sessions end when the TV starts another playback, leaves the player, is revoked, after hours without requests
 * and on quit; their folders are deleted.
 */
export class Transcoder {
  private sessions = new Map<string, Live>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: TranscoderOptions) {
    rmSync(opts.cacheDir, { recursive: true, force: true });
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  list(): TranscodeSession[] {
    return [...this.sessions.values()].map((s) => this.view(s));
  }

  private view(s: Live): TranscodeSession {
    return {
      id: s.id,
      deviceId: s.deviceId,
      itemId: s.itemId,
      plan: s.plan,
      durationMs: s.durationMs,
      starts: s.starts,
      dir: s.dir,
      startedAt: s.startedAt,
      lastAccess: s.lastAccess,
      lastSegment: s.lastSegment,
      runningFrom: s.runningFrom,
      speed: s.speed,
      exitCode: s.exitCode,
      finished: s.finished,
    };
  }

  get(id: string): TranscodeSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.lastAccess = this.now();
    return this.view(s);
  }

  async start(req: TranscodeRequest): Promise<TranscodeSession> {
    // One playback per TV: a new one replaces the old session.
    for (const s of [...this.sessions.values()]) if (s.deviceId === req.deviceId) this.stop(s.id);
    if (req.plan.mode === 'video') {
      const busy = [...this.sessions.values()].find((s) => s.plan.mode === 'video' && s.proc !== null);
      if (busy) throw new AppError('TV_TRANSCODE_BUSY');
    }
    const id = randomBytes(12).toString('hex');
    const dir = join(this.opts.cacheDir, id);
    mkdirSync(dir, { recursive: true });
    let textSubtitleFile = false;
    let imageSubtitleIndex: number | null = null;
    if (req.plan.subtitles.delivery === 'burn-in' && req.plan.subtitles.index !== null) {
      // The planner sends image subtitles (PGS) to overlay and text subtitles (ASS/SRT) through libass.
      const textual = await this.opts
        .runFfmpeg(extractAssArgs(req.input, req.plan.subtitles.index), dir)
        .then(() => existsSync(join(dir, BURN_IN_FILE)))
        .catch(() => false);
      if (textual) textSubtitleFile = true;
      else imageSubtitleIndex = req.plan.subtitles.index;
    }
    const count = req.starts.length;
    const session: Live = {
      id,
      deviceId: req.deviceId,
      itemId: req.itemId,
      plan: req.plan,
      durationMs: req.durationMs,
      starts: req.starts,
      dir,
      startedAt: this.now(),
      lastAccess: this.now(),
      lastSegment: 0,
      runningFrom: null,
      speed: null,
      exitCode: null,
      finished: false,
      input: req.input,
      done: new Set(),
      runLast: -1,
      proc: null,
      exited: Promise.resolve(),
      starting: null,
      failures: 0,
      imageSubtitleIndex,
      textSubtitleFile,
    };
    this.sessions.set(id, session);
    let first = 0;
    while (first + 1 < count && req.starts[first + 1]! <= req.startMs) first++;
    session.lastSegment = first;
    this.opts.log.info(`transcode ${id}: ${req.plan.mode} for device ${req.deviceId} from segment ${first}`);
    await this.run(session, first);
    this.schedule();
    return this.view(session);
  }

  /** (Re)starts FFmpeg of a session at a segment, after the previous process has let go of the files. */
  private run(s: Live, from: number): Promise<void> {
    const previous = s.starting ?? Promise.resolve();
    const next = previous.then(async () => {
      if (!this.sessions.has(s.id)) return;
      if (s.proc && s.runningFrom === from) return;
      this.halt(s);
      await Promise.race([s.exited, new Promise((r) => setTimeout(r, 3_000))]);
      if (!this.sessions.has(s.id)) return;
      // The list belongs to one run; segments the new run rewrites stay servable until it reaches them (same cuts).
      rmSync(join(s.dir, SEGMENT_LIST), { force: true });
      s.runLast = from - 1;
      const proc = this.opts.spawn(
        buildHlsArgs({
          plan: s.plan,
          input: s.input,
          starts: s.starts,
          startSegment: from,
          imageSubtitleIndex: s.imageSubtitleIndex,
          textSubtitleFile: s.textSubtitleFile,
        }),
        s.dir,
      );
      s.proc = proc;
      s.runningFrom = from;
      s.finished = false;
      s.exitCode = null;
      s.speed = null;
      s.exited = new Promise((resolve) =>
        proc.onExit((code) => {
          resolve();
          if (s.proc === proc) this.refresh(s);
          if (s.proc !== proc) return; // killed on purpose (seek, pause ahead, idle, stop)
          s.proc = null;
          s.runningFrom = null;
          s.exitCode = code;
          if (code === 0) s.finished = true;
          else {
            s.failures++;
            if (this.sessions.has(s.id)) this.opts.log.warn(`ffmpeg session ${s.id} ended with ${code ?? 'signal'}`);
          }
        }),
      );
      proc.onProgress((key, value) => {
        if (key === 'speed') {
          const x = parseFloat(value);
          s.speed = Number.isFinite(x) ? x : null;
        }
      });
    });
    const chained: Promise<void> = next
      .catch((error: unknown) => this.opts.log.warn(`ffmpeg session ${s.id} did not start`, error))
      .finally(() => {
        if (s.starting === chained) s.starting = null;
      });
    s.starting = chained;
    return next;
  }

  /** Stops FFmpeg of a session but keeps the session (a later segment request starts it again). */
  private halt(s: Live): void {
    const proc = s.proc;
    if (!proc) return;
    this.refresh(s);
    // The segment FFmpeg was writing stays unfinished on disk.
    s.done.delete(s.runLast + 1);
    s.proc = null;
    s.runningFrom = null;
    proc.kill();
  }

  stop(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    this.halt(s);
    // The process may hold the files for a moment after the kill: retry the delete.
    const remove = (attempt: number) => {
      try {
        rmSync(s.dir, { recursive: true, force: true });
      } catch {
        if (attempt < 5) setTimeout(() => remove(attempt + 1), 500);
      }
    };
    void s.exited.then(() => remove(0));
  }

  stopDevice(deviceId: string): void {
    for (const s of [...this.sessions.values()]) if (s.deviceId === deviceId) this.stop(s.id);
  }

  stopAll(): void {
    for (const id of [...this.sessions.keys()]) this.stop(id);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    rmSync(this.opts.cacheDir, { recursive: true, force: true });
  }

  /** The VOD playlist of a session. */
  playlist(session: TranscodeSession): string {
    return vodPlaylist(session.durationMs, session.starts);
  }

  /** Reads FFmpeg's list of finished segments (one line per segment: name,start,end). */
  private refresh(s: Live): void {
    let text: string;
    try {
      text = readFileSync(join(s.dir, SEGMENT_LIST), 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      const n = segmentNumber(line.split(',')[0]?.trim() ?? '');
      if (n === null || !line.includes(',')) continue;
      s.done.add(n);
      if (s.runningFrom !== null && n > s.runLast) s.runLast = n;
    }
  }

  /** Finished and not being rewritten by the running FFmpeg right now. */
  private ready(s: Live, n: number): boolean {
    this.refresh(s);
    if (s.proc && n === s.runLast + 1) return false;
    return s.done.has(n) && existsSync(join(s.dir, segmentName(n)));
  }

  /** Highest segment FFmpeg has finished in a row from `n` (n − 1 when `n` is not there). */
  private writtenFrom(s: Live, n: number): number {
    this.refresh(s);
    let last = n - 1;
    while (last + 1 < s.starts.length && s.done.has(last + 1)) last++;
    return last;
  }

  /**
   * Path of segment `name`, waiting until FFmpeg finished it. Starts FFmpeg there when it does not run, the segment
   * is behind it or far ahead of it; starts it again ahead of the player after a pause.
   */
  async file(session: TranscodeSession, name: string, timeoutMs = 60_000): Promise<string> {
    const s = this.sessions.get(session.id);
    if (!s) throw new AppError('NOT_FOUND');
    s.lastAccess = this.now();
    const n = segmentNumber(name);
    if (n === null || n >= s.starts.length) throw new AppError('NOT_FOUND');
    const path = join(s.dir, name);
    s.lastSegment = n;
    if (this.ready(s, n)) {
      this.resumeAhead(s, n);
      return path;
    }
    const failuresAtStart = s.failures;
    return this.waitFor(s, n, timeoutMs, () => {
      if (s.failures - failuresAtStart >= MAX_FAILURES) throw new AppError('TV_UNSUPPORTED_MEDIA');
      const from = s.runningFrom;
      const written = from === null ? -1 : Math.max(from - 1, this.writtenFrom(s, from));
      if (from === null || n < from || n - written > RESTART_GAP) {
        if (!s.starting) this.run(s, n).catch(() => undefined);
        return true;
      }
      return false;
    });
  }

  private async waitFor(s: Live, n: number, timeoutMs: number, check: () => boolean): Promise<string> {
    const deadline = this.now() + timeoutMs;
    check();
    for (;;) {
      if (this.ready(s, n)) return join(s.dir, segmentName(n));
      if (!this.sessions.has(s.id)) throw new AppError('NOT_FOUND');
      if (this.now() > deadline) throw new AppError('TV_TRANSCODE_BUSY', 'timeout');
      await new Promise((r) => setTimeout(r, 150));
      s.lastAccess = this.now();
      if (!s.starting) check();
    }
  }

  /** FFmpeg was stopped ahead of the player (or idle): start it again before the player runs out of segments. */
  private resumeAhead(s: Live, n: number): void {
    if (s.proc || s.starting) return;
    const last = this.writtenFrom(s, n);
    if (last >= s.starts.length - 1) return;
    if (last - n < RESUME_AHEAD) this.run(s, last + 1).catch(() => undefined);
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 5_000);
    this.timer.unref?.();
  }

  /**
   * Idle sessions stop FFmpeg, then end after hours; FFmpeg stops far ahead of the player; over the disk limit,
   * segments behind the players are deleted first, then FFmpeg stops for sessions that still write ahead.
   */
  sweep(): void {
    const idle = this.opts.idleMs ?? 60_000;
    const ttl = this.opts.sessionTtlMs ?? 6 * 60 * 60_000;
    for (const s of [...this.sessions.values()]) {
      const quiet = this.now() - s.lastAccess;
      if (quiet > ttl) this.stop(s.id);
      else if (quiet > idle) this.halt(s);
      else if (s.runningFrom !== null && this.writtenFrom(s, s.lastSegment) - s.lastSegment > MAX_AHEAD) this.halt(s);
    }
    if (this.sessions.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    let total = 0;
    const behind: { s: Live; n: number; path: string; size: number }[] = [];
    for (const s of this.sessions.values()) {
      let names: string[];
      try {
        names = readdirSync(s.dir);
      } catch {
        continue;
      }
      for (const name of names) {
        try {
          const size = statSync(join(s.dir, name)).size;
          total += size;
          const n = segmentNumber(name);
          if (n !== null && (n < s.lastSegment - KEEP_BEHIND || n > s.lastSegment + MAX_AHEAD))
            behind.push({ s, n, path: join(s.dir, name), size });
        } catch {
          /* written right now */
        }
      }
    }
    const limit = this.opts.cacheLimitBytes();
    if (total <= limit) return;
    for (const f of behind) {
      if (total <= limit) break;
      f.s.done.delete(f.n);
      rmSync(f.path, { force: true });
      total -= f.size;
    }
    if (total > limit) for (const s of this.sessions.values()) this.halt(s);
  }
}

/** Runs FFmpeg to completion with a working directory (subtitle extraction). */
export function runFfmpegIn(ffmpeg: string): (args: string[], cwd: string) => Promise<void> {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, args, { cwd, shell: false, windowsHide: true, stdio: 'ignore' });
      const timer = setTimeout(() => killTree(child), 120_000);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new AppError('TV_UNSUPPORTED_MEDIA'));
      });
    });
}
