import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { JackettStatus } from '@shared/contracts/sources';
import { AppError } from '@shared/errors';
import type { Logger } from '../logger';
import { redact } from '../redact';
import type { Secrets } from '../secrets';
import { Emitter } from '../util/emitter';
import { JackettAdmin } from './jackett-admin';

/** Running Jackett process (real child or a test double). */
export interface JackettProcess {
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type JackettSpawner = (exe: string, args: string[], log: Logger) => JackettProcess;

export interface JackettConnection {
  baseUrl: string;
  apiKey: string;
  admin: JackettAdmin;
}

export interface JackettManagerOptions {
  /** JackettConsole.exe, or null when not bundled (dev without vendor/jackett). */
  exePath: string | null;
  dataDir: string;
  secrets: Secrets;
  log: Logger;
  /** ADRENALINE_NO_JACKETT=1 (dev/tests). */
  disabled?: boolean;
  spawn?: JackettSpawner;
  fetch?: typeof fetch;
  freePort?: () => Promise<number>;
  startTimeoutMs?: number;
  backoffMs?: number[];
  maxCrashes?: number;
  crashWindowMs?: number;
  now?: () => number;
}

const API_KEY_SECRET = 'jackett.apiKey';
const PASSWORD_SECRET = 'jackett.adminPassword';

function spawnJackett(exe: string, args: string[], log: Logger): JackettProcess {
  const child = spawn(exe, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const onLine = (d: Buffer) => {
    for (const line of d.toString('utf8').split(/\r?\n/)) if (line.trim()) log.debug(redact(line));
  };
  child.stdout.on('data', onLine);
  child.stderr.on('data', onLine);
  const exitListeners: ((code: number | null) => void)[] = [];
  let exited = false;
  const done = (code: number | null) => {
    if (exited) return;
    exited = true;
    for (const l of exitListeners) l(code);
  };
  child.on('exit', (code) => done(code));
  child.on('error', (error) => {
    log.error('jackett spawn failed', error);
    done(null);
  });
  return {
    onExit: (l) => void exitListeners.push(l),
    // D-56: the hidden console process ignores a graceful close; Jackett writes its config when it changes.
    kill: () => {
      if (!exited) child.kill();
    },
  };
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Bundled Jackett (D-50, D-56): own data folder in userData, port and API key written into ServerConfig.json before
 * start (no admin needed), loopback only, random admin password, restart with backoff (max 3 crashes / 5 min).
 */
export class JackettManager extends Emitter<{ status: JackettStatus }> {
  private statusValue: JackettStatus;
  private process: JackettProcess | null = null;
  private connection: JackettConnection | null = null;
  private starting: Promise<JackettConnection> | null = null;
  private stopping = false;
  private crashes: number[] = [];
  private restartTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: JackettManagerOptions) {
    super();
    this.statusValue = opts.disabled
      ? { state: 'disabled' }
      : opts.exePath && existsSync(opts.exePath)
        ? { state: 'stopped' }
        : { state: 'unavailable', message: 'JACKETT_UNAVAILABLE' };
  }

  get status(): JackettStatus {
    return this.statusValue;
  }

  get available(): boolean {
    return this.statusValue.state !== 'disabled' && this.statusValue.state !== 'unavailable';
  }

  private setStatus(status: JackettStatus) {
    this.statusValue = status;
    this.emit('status', status);
  }

  /** Starts Jackett if needed (shared by concurrent callers) and returns a logged-in connection. */
  async ensureRunning(): Promise<JackettConnection> {
    if (!this.available) throw new AppError('JACKETT_UNAVAILABLE', this.statusValue.state);
    if (this.connection && this.statusValue.state === 'running') return this.connection;
    if (this.statusValue.state === 'crashed') throw new AppError('JACKETT_UNAVAILABLE', 'crashed');
    this.starting ??= this.start()
      .catch((error: unknown) => {
        this.process?.kill();
        this.process = null;
        this.connection = null;
        this.opts.log.warn('jackett start failed', error);
        this.setStatus({ state: 'stopped', message: 'JACKETT_UNAVAILABLE' });
        throw error instanceof AppError ? error : new AppError('JACKETT_UNAVAILABLE');
      })
      .finally(() => {
        this.starting = null;
      });
    return this.starting;
  }

  private prepareConfig(port: number): string {
    mkdirSync(this.opts.dataDir, { recursive: true });
    const path = join(this.opts.dataDir, 'ServerConfig.json');
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      /* first start or unreadable: Jackett fills in the rest */
    }
    const stored = this.opts.secrets.get(API_KEY_SECRET);
    const apiKey =
      stored ?? (typeof existing['APIKey'] === 'string' ? existing['APIKey'] : randomBytes(16).toString('hex'));
    writeFileSync(
      path,
      JSON.stringify(
        {
          ...existing,
          Port: port,
          LocalBindAddress: '127.0.0.1',
          AllowExternal: false,
          UpdateDisabled: true,
          APIKey: apiKey,
        },
        null,
        2,
      ),
    );
    if (stored !== apiKey) this.opts.secrets.set(API_KEY_SECRET, apiKey);
    return apiKey;
  }

  private async start(): Promise<JackettConnection> {
    this.stopping = false;
    this.setStatus({ state: this.crashes.length ? 'restarting' : 'starting' });
    const port = await (this.opts.freePort ?? freeLoopbackPort)();
    const apiKey = this.prepareConfig(port);
    const baseUrl = `http://127.0.0.1:${port}`;
    const proc = (this.opts.spawn ?? spawnJackett)(
      this.opts.exePath!,
      ['--NoUpdates', '--NoRestart', '--ListenPrivate', '--DataFolder', this.opts.dataDir],
      this.opts.log,
    );
    this.process = proc;
    let exited = false;
    proc.onExit((code) => {
      exited = true;
      this.onExit(proc, code);
    });

    const fetchFn = this.opts.fetch ?? fetch;
    const deadline = (this.opts.now ?? Date.now)() + (this.opts.startTimeoutMs ?? 30_000);
    for (;;) {
      if (exited) throw new AppError('JACKETT_UNAVAILABLE', 'exited during start');
      const up = await fetchFn(`${baseUrl}/UI/Login`, { redirect: 'manual', signal: AbortSignal.timeout(2_000) }).then(
        async (r) => {
          await r.body?.cancel();
          return true;
        },
        () => false,
      );
      if (up) break;
      if ((this.opts.now ?? Date.now)() > deadline) {
        proc.kill();
        throw new AppError('JACKETT_UNAVAILABLE', 'start timeout');
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const admin = new JackettAdmin({ baseUrl, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) });
    const password = this.opts.secrets.get(PASSWORD_SECRET);
    let ok = password ? await admin.login(password) : false;
    if (!ok) {
      // First start, or the data folder was reset: no password set yet → set a new random one (D-57).
      ok = await admin.login('');
      if (!ok) throw new AppError('JACKETT_UNAVAILABLE', 'admin login failed');
      const fresh = randomBytes(18).toString('base64url');
      await admin.setAdminPassword(fresh);
      this.opts.secrets.set(PASSWORD_SECRET, fresh);
      if (!(await admin.login(fresh))) throw new AppError('JACKETT_UNAVAILABLE', 'admin login failed');
    }
    const config = await admin.serverConfig();
    this.connection = { baseUrl, apiKey, admin };
    this.setStatus({ state: 'running', ...(config.app_version ? { version: config.app_version } : {}) });
    this.opts.log.info(`jackett ${config.app_version ?? '?'} running on 127.0.0.1:${port}`);
    return this.connection;
  }

  private onExit(proc: JackettProcess, code: number | null) {
    if (this.process !== proc) return;
    // An exit during start is reported by start() itself (no restart loop).
    if (this.starting && !this.connection) {
      this.process = null;
      return;
    }
    this.process = null;
    this.connection = null;
    if (this.stopping) {
      this.setStatus({ state: 'stopped' });
      return;
    }
    const now = (this.opts.now ?? Date.now)();
    const windowMs = this.opts.crashWindowMs ?? 5 * 60_000;
    this.crashes = [...this.crashes.filter((t) => now - t < windowMs), now];
    this.opts.log.warn(`jackett exited unexpectedly (code ${code ?? 'null'})`);
    if (this.crashes.length >= (this.opts.maxCrashes ?? 3)) {
      this.setStatus({ state: 'crashed', message: 'JACKETT_UNAVAILABLE' });
      return;
    }
    const backoff = this.opts.backoffMs ?? [1_000, 5_000, 30_000];
    const delay = backoff[Math.min(this.crashes.length - 1, backoff.length - 1)] ?? 1_000;
    this.setStatus({ state: 'restarting' });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.ensureRunning().catch((error: unknown) => this.opts.log.warn('jackett restart failed', error));
    }, delay);
  }

  /** Manual restart from Settings → Sources (also clears a crashed state). */
  async restart(): Promise<JackettConnection> {
    await this.stop();
    this.crashes = [];
    if (this.available) this.setStatus({ state: 'stopped' });
    return this.ensureRunning();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const proc = this.process;
    if (!proc) return;
    const exited = new Promise<void>((resolve) => proc.onExit(() => resolve()));
    proc.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
  }
}
