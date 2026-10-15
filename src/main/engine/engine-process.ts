import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { EngineArgs, EngineEvent, EngineOp, EngineResult } from '@shared/contracts/engine';
import { AppError } from '@shared/errors';
import type { EngineStatus } from '@shared/contracts/app';
import type { Logger } from '../logger';
import { redact } from '../redact';
import { Emitter } from '../util/emitter';
import { EngineClient, type EngineTransport, type RequestOptions } from './engine-client';

/** One running engine instance (real child process or FakeEngine). */
export interface EngineInstance {
  transport: EngineTransport;
  kill(): void;
}

export type EngineLauncher = () => EngineInstance;

export interface SpawnOptions {
  binaryPath: string;
  args: string[];
  log: Logger;
}

/** Spawns the engine binary: absolute path, no shell, hidden window; stdout = protocol, stderr = log. */
export function spawnEngine(opts: SpawnOptions): EngineInstance {
  const child = spawn(opts.binaryPath, opts.args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const lineListeners: ((line: string) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const l of closeListeners) l();
  };
  createInterface({ input: child.stdout }).on('line', (line) => {
    for (const l of lineListeners) l(line);
  });
  createInterface({ input: child.stderr }).on('line', (line) => opts.log.debug(`stderr: ${redact(line)}`));
  child.on('exit', (code, signal) => {
    opts.log.info(`engine exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    close();
  });
  child.on('error', (error) => {
    opts.log.error('engine spawn failed', error);
    close();
  });
  child.stdin.on('error', () => undefined);
  return {
    transport: {
      write: (line) => {
        if (!closed && child.stdin.writable) child.stdin.write(`${line}\n`);
      },
      onLine: (l) => void lineListeners.push(l),
      onClose: (l) => void closeListeners.push(l),
    },
    kill: () => {
      if (!closed) child.kill();
    },
  };
}

/**
 * Engine binary: ADRENALINE_ENGINE_PATH (dev/tests) → resources/engine (installed app) → native/engine/build (dev).
 */
export function resolveEnginePath(opts: {
  env: NodeJS.ProcessEnv;
  isPackaged: boolean;
  resourcesPath: string;
  appRoot: string;
  platform?: NodeJS.Platform;
}): string | null {
  const exe = (opts.platform ?? process.platform) === 'win32' ? 'adrenaline-engine.exe' : 'adrenaline-engine';
  const fromEnv = opts.env['ADRENALINE_ENGINE_PATH'];
  if (fromEnv && !opts.isPackaged) return fromEnv;
  if (opts.isPackaged) {
    const p = join(opts.resourcesPath, 'engine', 'adrenaline-engine.exe');
    return existsSync(p) ? p : null;
  }
  for (const preset of ['windows-release', 'linux-system', 'linux-dev']) {
    const p = join(opts.appRoot, 'native', 'engine', 'build', preset, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

export type SupervisorEvents = {
  status: EngineStatus;
  event: EngineEvent;
  /** A (re)started engine answered `hello`: re-add jobs and take a snapshot. */
  ready: { restarted: boolean };
  gap: undefined;
};

export interface SupervisorOptions {
  launch: EngineLauncher;
  log: Logger;
  clientVersion: string;
  backoffMs?: number[];
  crashWindowMs?: number;
  maxCrashes?: number;
  heartbeatMs?: number;
  missedHeartbeats?: number;
  requestTimeoutMs?: number;
  now?: () => number;
}

/**
 * Keeps one engine running (02-protokol-silnika.md, EngineProcess): restart with 1 s / 5 s / 30 s backoff, at most
 * 3 crashes in 5 minutes (then ENGINE_CRASHED, no restart loop), heartbeat `ping` every 5 s (3 missed = hung).
 */
export class EngineSupervisor extends Emitter<SupervisorEvents> {
  private instance: EngineInstance | null = null;
  private current: EngineClient | null = null;
  private crashes: number[] = [];
  private stopping = false;
  private everStarted = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private missed = 0;
  private statusValue: EngineStatus = { state: 'stopped' };

  constructor(private readonly opts: SupervisorOptions) {
    super();
  }

  get status(): EngineStatus {
    return this.statusValue;
  }

  get client(): EngineClient | null {
    return this.current && !this.current.isClosed && this.statusValue.state === 'running' ? this.current : null;
  }

  async request<O extends EngineOp>(
    op: O,
    args: EngineArgs[O],
    jobId?: string,
    options?: RequestOptions,
  ): Promise<EngineResult<O>> {
    const client = this.client;
    if (!client) throw new AppError('ENGINE_UNAVAILABLE', 'engine not running');
    return client.request(op, args, jobId, options);
  }

  /** Starts the engine; resolves when it answered `hello` (or failed to). */
  async start(): Promise<void> {
    this.stopping = false;
    await this.launch();
  }

  private setStatus(status: EngineStatus) {
    this.statusValue = status;
    this.emit('status', status);
  }

  private async launch(): Promise<void> {
    const restarted = this.everStarted;
    this.setStatus({ ...this.statusValue, state: restarted ? 'restarting' : 'starting' });
    let instance: EngineInstance;
    try {
      instance = this.opts.launch();
    } catch (error) {
      this.opts.log.error('engine launch failed', error);
      this.setStatus({ state: 'crashed', message: 'ENGINE_UNAVAILABLE' });
      return;
    }
    this.instance = instance;
    const client = new EngineClient({
      transport: instance.transport,
      log: this.opts.log,
      ...(this.opts.requestTimeoutMs ? { timeoutMs: this.opts.requestTimeoutMs } : {}),
    });
    this.current = client;
    client.on('event', (e) => this.emit('event', e));
    client.on('gap', () => this.emit('gap', undefined));
    client.on('closed', () => this.onClosed(client));
    try {
      const hello = await client.hello(this.opts.clientVersion);
      if (this.current !== client) return;
      this.everStarted = true;
      this.setStatus({
        state: 'running',
        engineVersion: hello.engineVersion,
        libtorrent: hello.libtorrent,
        ...(hello.listenPort !== undefined ? { listenPort: hello.listenPort } : {}),
      });
      this.startHeartbeat(client);
      this.emit('ready', { restarted });
    } catch (error) {
      if (error instanceof AppError && error.code === 'ENGINE_PROTOCOL_MISMATCH') {
        this.opts.log.error('engine protocol mismatch', error);
        this.stopping = true;
        instance.kill();
        this.setStatus({ state: 'crashed', message: 'ENGINE_PROTOCOL_MISMATCH' });
        return;
      }
      this.opts.log.warn('engine did not answer hello', error);
      instance.kill();
    }
  }

  private startHeartbeat(client: EngineClient) {
    this.stopHeartbeat();
    this.missed = 0;
    const every = this.opts.heartbeatMs ?? 5_000;
    const limit = this.opts.missedHeartbeats ?? 3;
    this.heartbeat = setInterval(() => {
      client.request('ping', {}, undefined, { timeoutMs: every, retries: 0 }).then(
        () => {
          this.missed = 0;
        },
        () => {
          this.missed += 1;
          if (this.missed >= limit) {
            this.opts.log.warn('engine heartbeat lost, killing the process');
            this.instance?.kill();
          }
        },
      );
    }, every);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private onClosed(client: EngineClient) {
    if (this.current !== client) return;
    this.stopHeartbeat();
    this.current = null;
    this.instance = null;
    if (this.stopping) {
      this.setStatus({ state: 'stopped' });
      return;
    }
    const now = (this.opts.now ?? Date.now)();
    const windowMs = this.opts.crashWindowMs ?? 5 * 60_000;
    this.crashes = [...this.crashes.filter((t) => now - t < windowMs), now];
    const max = this.opts.maxCrashes ?? 3;
    if (this.crashes.length >= max) {
      this.opts.log.error(`engine crashed ${this.crashes.length} times in ${windowMs / 1000} s, giving up`);
      this.setStatus({ state: 'crashed', message: 'ENGINE_CRASHED' });
      return;
    }
    const backoff = this.opts.backoffMs ?? [1_000, 5_000, 30_000];
    const delay = backoff[Math.min(this.crashes.length - 1, backoff.length - 1)] ?? 1_000;
    this.opts.log.warn(`engine exited unexpectedly, restarting in ${delay} ms`);
    this.setStatus({ state: 'restarting' });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.launch();
    }, delay);
  }

  /** Manual restart after ENGINE_CRASHED (button in the UI). */
  async restart(): Promise<void> {
    this.crashes = [];
    if (this.current) return;
    await this.start();
  }

  /** Immediate kill without shutdown or restart (crash simulation, last resort when the shutdown hangs). */
  kill(): void {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.stopHeartbeat();
    this.instance?.kill();
  }

  /** Graceful stop: `shutdown` (resume data saved, max ~12 s), then kill. No restart. */
  async stop(timeoutMs = 12_000): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.stopHeartbeat();
    const client = this.current;
    const instance = this.instance;
    if (!client || !instance) {
      this.setStatus({ state: 'stopped' });
      return;
    }
    const closed = new Promise<void>((resolve) => client.once('closed', () => resolve()));
    try {
      await client.request('shutdown', {}, undefined, { timeoutMs, retries: 0 });
    } catch (error) {
      this.opts.log.warn('engine shutdown failed', error);
    }
    // The engine exits by itself after replying; kill it if it does not.
    const timer = setTimeout(() => instance.kill(), 3_000);
    await closed;
    clearTimeout(timer);
  }
}
