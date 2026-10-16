import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { PlaybackPlan } from '@shared/domain/playback';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import { buildHlsArgs, BURN_IN_FILE, extractAssArgs, PLAYLIST } from './ffmpeg-args';

export interface TranscodeRequest {
  deviceId: string;
  itemId: string;
  input: string;
  plan: PlaybackPlan;
  startMs: number;
}

export interface TranscodeSession {
  id: string;
  deviceId: string;
  itemId: string;
  plan: PlaybackPlan;
  startMs: number;
  dir: string;
  startedAt: number;
  lastAccess: number;
  /** Highest segment number requested by the player (old segments can be pruned). */
  lastSegment: number;
  /** FFmpeg speed (×realtime) from `-progress`, for diagnostics. */
  speed: number | null;
  exitCode: number | null;
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
  idleMs?: number;
  now?: () => number;
}

/** Number of a segment file name (`seg00042.m4s` → 42). */
export function segmentNumber(name: string): number | null {
  const m = /^seg(\d{5})\.m4s$/.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * HLS sessions (D-85): one FFmpeg per playing TV. At most one session encodes video at a time (the expensive part);
 * a TV starting a new playback or seeking replaces its own session. Sessions die after a minute without requests, on
 * revoke and on quit; their folders are deleted. When the cache is over its limit, segments far behind the player are
 * removed (seeking back there starts a new session).
 */
export class Transcoder {
  private sessions = new Map<string, TranscodeSession & { proc: ProcessHandle | null }>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: TranscoderOptions) {
    rmSync(opts.cacheDir, { recursive: true, force: true });
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  list(): TranscodeSession[] {
    return [...this.sessions.values()].map(({ proc: _proc, ...s }) => s);
  }

  get(id: string): TranscodeSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    s.lastAccess = this.now();
    return s;
  }

  async start(req: TranscodeRequest): Promise<TranscodeSession> {
    // One playback per TV: a new one (or a seek) replaces the old session.
    for (const s of [...this.sessions.values()]) if (s.deviceId === req.deviceId) this.stop(s.id);
    if (req.plan.mode === 'video') {
      const busy = [...this.sessions.values()].find((s) => s.plan.mode === 'video' && !s.finished);
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
    const args = buildHlsArgs({
      plan: req.plan,
      input: req.input,
      startMs: req.startMs,
      imageSubtitleIndex,
      textSubtitleFile,
    });
    const session = {
      id,
      deviceId: req.deviceId,
      itemId: req.itemId,
      plan: req.plan,
      startMs: req.startMs,
      dir,
      startedAt: this.now(),
      lastAccess: this.now(),
      lastSegment: 0,
      speed: null as number | null,
      exitCode: null as number | null,
      finished: false,
      proc: null as ProcessHandle | null,
    };
    const proc = this.opts.spawn(args, dir);
    session.proc = proc;
    proc.onProgress((key, value) => {
      if (key === 'speed') {
        const x = parseFloat(value);
        session.speed = Number.isFinite(x) ? x : null;
      }
    });
    proc.onExit((code) => {
      session.exitCode = code;
      session.finished = true;
      session.proc = null;
      if (code !== 0 && this.sessions.has(id))
        this.opts.log.warn(`ffmpeg session ${id} ended with ${code ?? 'signal'}`);
    });
    this.sessions.set(id, session);
    this.opts.log.info(`transcode ${id}: ${req.plan.mode} for device ${req.deviceId} from ${req.startMs} ms`);
    this.schedule();
    return session;
  }

  stop(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.proc?.kill();
    // The process may hold the files for a moment after the kill: retry the delete.
    const remove = (attempt: number) => {
      try {
        rmSync(s.dir, { recursive: true, force: true });
      } catch {
        if (attempt < 5) setTimeout(() => remove(attempt + 1), 500);
      }
    };
    remove(0);
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

  /** Waits until FFmpeg wrote a file of the session (playlist or segment), or fails when it ended without it. */
  async waitForFile(session: TranscodeSession, name: string, timeoutMs = 30_000): Promise<string> {
    const path = join(session.dir, name);
    const deadline = this.now() + timeoutMs;
    for (;;) {
      if (existsSync(path) && (name !== PLAYLIST || this.playlistReady(path))) return path;
      const live = this.sessions.get(session.id);
      if (!live) throw new AppError('NOT_FOUND');
      if (live.finished) {
        if (existsSync(path)) return path;
        throw new AppError(live.exitCode === 0 ? 'NOT_FOUND' : 'TV_UNSUPPORTED_MEDIA');
      }
      if (this.now() > deadline) throw new AppError('TV_TRANSCODE_BUSY', 'timeout');
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  /** A playlist is useful once it lists a segment. */
  private playlistReady(path: string): boolean {
    try {
      return statSync(path).size > 0 && /seg\d{5}\.m4s/.test(readFileSync(path, 'utf8'));
    } catch {
      return false;
    }
  }

  markSegment(session: TranscodeSession, name: string): void {
    const n = segmentNumber(name);
    if (n !== null && n > session.lastSegment) session.lastSegment = n;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), 10_000);
    this.timer.unref?.();
  }

  /** Idle sessions stop; over the disk limit, segments far behind the player are deleted. */
  sweep(): void {
    const idle = this.opts.idleMs ?? 60_000;
    for (const s of [...this.sessions.values()]) if (this.now() - s.lastAccess > idle) this.stop(s.id);
    if (this.sessions.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    let total = 0;
    const files: { path: string; size: number; behind: boolean }[] = [];
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
          files.push({ path: join(s.dir, name), size, behind: n !== null && n < s.lastSegment - 10 });
        } catch {
          /* written right now */
        }
      }
    }
    const limit = this.opts.cacheLimitBytes();
    if (total <= limit) return;
    for (const f of files.filter((x) => x.behind)) {
      if (total <= limit) break;
      rmSync(f.path, { force: true });
      total -= f.size;
    }
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
