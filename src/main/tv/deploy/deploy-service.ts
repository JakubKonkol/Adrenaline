import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TvDeployRequest, TvDeployState, TvDeployStep, TvToolchain } from '@shared/contracts/tv';
import { AppError, type AppErrorCode } from '@shared/errors';
import type { Logger } from '../../logger';
import { redact } from '../../redact';
import { Emitter } from '../../util/emitter';
import { type ProcessRunner, type RunResult, runProcess } from './process-runner';
import { prepareAutomaticAdb } from './android-tools';
import { prepareAutomaticTizen, type AutomaticTizenTools } from './tizen-tools';
import { packageTizen } from './tizen-signing';

/** resources/tv/manifest.json (scripts/tv/write-manifest.mjs). */
export interface TvManifest {
  version: string;
  android: { file: string; sha256: string; applicationId: string; activity: string; signing: string };
  tizen: { dir: string; packageId: string; appId: string; files: { path: string; sha256: string }[] };
}

export interface DeployDeps {
  /** resources/tv in the installed app (out of the repo in development). */
  tvDir: string;
  /** userData/tv-deploy: packages signed for this PC's TVs. */
  workDir: string;
  toolchain: () => TvToolchain;
  /** Address the TV app must use (the PC's TV server), or null when the server is off. */
  serverUrl: () => string | null;
  /** Resolves when a TV app from this address talked to the server after `since` (paired and connected). */
  waitForTv: (address: string, since: number, signal: AbortSignal) => Promise<boolean>;
  log: Logger;
  run?: ProcessRunner;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** How long to wait for the user on the TV (debugging prompt, pairing). */
  userWaitMs?: number;
  automaticTizen?: (cacheDir: string, signal: AbortSignal) => Promise<AutomaticTizenTools>;
  /** adb when none is installed: official platform-tools downloaded once (android-tools.ts). */
  automaticAdb?: (cacheDir: string, signal: AbortSignal) => Promise<string>;
  packageTizen?: typeof packageTizen;
}

const TIZEN_PORT = 26101;

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Tool output for the error details: last lines, credentials and pairing codes removed. */
function tail(r: RunResult | null, extra: string[] = []): string {
  if (!r) return '';
  let text = `${r.stdout}\n${r.stderr}`;
  for (const secret of extra) if (secret) text = text.split(secret).join('••••••');
  return redact(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-6)
    .join('\n')
    .slice(0, 600);
}

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new AppError('DEPLOY_CANCELLED'));
      },
      { once: true },
    );
  });

/**
 * Deploy to TV (D-84, docs/1.0-adrenaline-tv/03-deploy-and-packaging.md): installs the bundled TV app on a TV by its
 * IP with the official tools, then waits until the app on the TV pairs with this PC. One deployment at a time; every
 * tool call has a timeout and is cancelled with the deployment. Only the given TV is addressed (never "the first
 * device"); nothing is uninstalled automatically.
 */
export class DeployService extends Emitter<{ state: TvDeployState }> {
  private current: TvDeployState | null = null;
  private controller: AbortController | null = null;

  constructor(private readonly deps: DeployDeps) {
    super();
  }

  get state(): TvDeployState | null {
    return this.current;
  }

  private now() {
    return (this.deps.now ?? Date.now)();
  }

  private set(patch: Partial<TvDeployState>) {
    if (!this.current) return;
    this.current = { ...this.current, ...patch };
    this.emit('state', this.current);
  }

  cancel(): void {
    this.controller?.abort();
  }

  /** Starts a deployment (rejects when one is running); progress arrives as `state` events. */
  start(request: TvDeployRequest): TvDeployState {
    if (this.current && (this.current.status === 'running' || this.current.status === 'action'))
      throw new AppError('BAD_REQUEST', 'a deployment is already running');
    this.controller = new AbortController();
    this.current = {
      platform: request.platform,
      address: request.address,
      step: 'preflight',
      status: 'running',
      errorCode: null,
      detail: null,
      duid: null,
      startedAt: this.now(),
    };
    this.emit('state', this.current);
    const signal = this.controller.signal;
    const job = request.platform === 'android' ? this.android(request, signal) : this.tizen(request, signal);
    void job.then(
      () => this.set({ status: 'done', errorCode: null }),
      (error: unknown) => {
        const code: AppErrorCode = signal.aborted
          ? 'DEPLOY_CANCELLED'
          : error instanceof AppError
            ? error.code
            : 'DEPLOY_INSTALL_FAILED';
        if (!(error instanceof AppError)) this.deps.log.error('deploy failed', error);
        this.set({
          status: code === 'DEPLOY_CANCELLED' ? 'cancelled' : 'error',
          errorCode: code,
          ...(error instanceof AppError && error.message !== code ? { detail: error.message } : {}),
        });
      },
    );
    return this.current;
  }

  private step(step: TvDeployStep) {
    this.set({ step, status: 'running', detail: null });
  }

  private async run(exe: string, args: string[], signal: AbortSignal, timeoutMs: number, input?: string) {
    if (signal.aborted) throw new AppError('DEPLOY_CANCELLED');
    // Only the tool and its arguments go to the log (the pairing code arrives through stdin).
    this.deps.log.info(`deploy: ${exe.split(/[\\/]/).pop()} ${args.join(' ')}`);
    const result = await (this.deps.run ?? runProcess)(exe, args, {
      timeoutMs,
      signal,
      ...(input !== undefined ? { input } : {}),
    }).catch((error: unknown) => {
      throw new AppError('DEPLOY_TOOL_MISSING', error instanceof Error ? error.message : String(error));
    });
    if (signal.aborted) throw new AppError('DEPLOY_CANCELLED');
    if (result.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(result, input ? [input] : []));
    return result;
  }

  private sleep(ms: number, signal: AbortSignal) {
    return (this.deps.sleep ?? defaultSleep)(ms, signal);
  }

  private manifest(): TvManifest {
    const path = join(this.deps.tvDir, 'manifest.json');
    if (!existsSync(path)) throw new AppError('DEPLOY_PACKAGE_MISSING');
    return JSON.parse(readFileSync(path, 'utf8')) as TvManifest;
  }

  private requireServer(): string {
    const url = this.deps.serverUrl();
    if (!url) throw new AppError('TV_SERVER_FAILED', 'Turn on the TV server first.');
    return url;
  }

  /** After launch: the TV app pairs (approved in the TV tab) and connects. */
  private async handshake(request: TvDeployRequest, launchedAt: number, signal: AbortSignal) {
    this.step('handshake');
    this.set({ status: 'action' });
    const ok = await this.deps.waitForTv(request.address, launchedAt, signal);
    if (signal.aborted) throw new AppError('DEPLOY_CANCELLED');
    if (!ok) throw new AppError('DEPLOY_TIMEOUT', 'The app was installed. Open Adrenaline on the TV to pair it.');
  }

  // ------------------------------------------------------------------ Android (adb)

  private async android(request: Extract<TvDeployRequest, { platform: 'android' }>, signal: AbortSignal) {
    const tools = this.deps.toolchain();
    const server = this.requireServer();
    const manifest = this.manifest();
    const apk = join(this.deps.tvDir, manifest.android.file);
    if (!existsSync(apk) || sha256(apk) !== manifest.android.sha256) throw new AppError('DEPLOY_PACKAGE_MISSING');
    let adb = tools.adb;
    if (!adb) {
      // No Android SDK on this PC: the official adb is downloaded once, like the Samsung tools.
      try {
        adb = await (this.deps.automaticAdb ?? prepareAutomaticAdb)(join(this.deps.workDir, 'tools'), signal);
      } catch (error) {
        if (error instanceof AppError || signal.aborted) throw error;
        throw new AppError(
          'DEPLOY_TOOL_MISSING',
          'Could not download the Android tools. Check the internet connection and retry.',
        );
      }
    }
    const serial = `${request.address}:${request.port}`;

    if (request.pairing) {
      this.step('pairing');
      const code = request.pairing.code;
      const r = await this.run(adb, ['pair', `${request.address}:${request.pairing.port}`], signal, 30_000, code);
      const out = `${r.stdout}\n${r.stderr}`;
      if (r.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(r, [code]));
      if (!/successfully paired/i.test(out))
        throw new AppError(
          /refused|unable to connect|no route|failed to connect/i.test(out)
            ? 'DEPLOY_CONNECT_FAILED'
            : 'DEPLOY_UNAUTHORIZED',
          tail(r, [code]),
        );
    }

    this.step('connecting');
    const connect = await this.run(adb, ['connect', serial], signal, 20_000);
    const connectOut = `${connect.stdout}\n${connect.stderr}`;
    if (connect.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(connect));
    if (!/connected to|already connected|failed to authenticate/i.test(connectOut))
      throw new AppError('DEPLOY_CONNECT_FAILED', tail(connect));

    this.step('authorizing');
    const deadline = this.now() + (this.deps.userWaitMs ?? 120_000);
    for (;;) {
      const state = await this.run(adb, ['-s', serial, 'get-state'], signal, 10_000);
      const text = `${state.stdout}\n${state.stderr}`;
      if (/^device\s*$/m.test(state.stdout)) break;
      // The TV shows "Allow USB/network debugging?" — the user must accept it.
      if (/unauthori[sz]ed/i.test(text)) this.set({ status: 'action', detail: null });
      else if (/not found|offline/i.test(text) && !/unauthori/i.test(text)) {
        await this.run(adb, ['connect', serial], signal, 20_000);
      }
      if (this.now() > deadline) throw new AppError('DEPLOY_UNAUTHORIZED', tail(state));
      await this.sleep(2_000, signal);
    }

    this.step('installing');
    const install = await this.run(adb, ['-s', serial, 'install', '-r', apk], signal, 300_000);
    const installOut = `${install.stdout}\n${install.stderr}`;
    if (!/^Success/m.test(install.stdout)) {
      if (install.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(install));
      if (/UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES|signatures do not match/i.test(installOut))
        throw new AppError('DEPLOY_SIGNATURE_MISMATCH', tail(install));
      if (/INSUFFICIENT_STORAGE|not enough space/i.test(installOut))
        throw new AppError('DEPLOY_NO_SPACE', tail(install));
      throw new AppError('DEPLOY_INSTALL_FAILED', tail(install));
    }

    this.step('launching');
    const launchedAt = this.now();
    const start = await this.run(
      adb,
      [
        ...['-s', serial, 'shell', 'am', 'start', '-n', manifest.android.activity],
        ...['--es', 'server', server, '--es', 'install', String(launchedAt)],
      ],
      signal,
      20_000,
    );
    if (/Error/i.test(`${start.stdout}\n${start.stderr}`)) throw new AppError('DEPLOY_INSTALL_FAILED', tail(start));
    await this.handshake(request, launchedAt, signal);
  }

  // ------------------------------------------------------------------ Samsung Tizen (sdb + tizen CLI)

  private async tizen(request: Extract<TvDeployRequest, { platform: 'tizen' }>, signal: AbortSignal) {
    const tools = this.deps.toolchain();
    const automatic = !request.profile;
    if (!automatic && (!tools.sdb || !tools.tizen)) throw new AppError('DEPLOY_TOOL_MISSING', 'tizen-studio');
    if (!automatic && !tools.profiles.includes(request.profile))
      throw new AppError('DEPLOY_CERTIFICATE', request.profile);
    const server = this.requireServer();
    const manifest = this.manifest();
    const webDir = join(this.deps.tvDir, manifest.tizen.dir);
    for (const f of manifest.tizen.files) {
      const path = join(webDir, ...f.path.split('/'));
      if (!existsSync(path) || sha256(path) !== f.sha256) throw new AppError('DEPLOY_PACKAGE_MISSING', f.path);
    }
    let prepared: AutomaticTizenTools | null = null;
    if (automatic) {
      try {
        prepared = await (this.deps.automaticTizen ?? prepareAutomaticTizen)(join(this.deps.workDir, 'tools'), signal);
      } catch (error) {
        if (error instanceof AppError || signal.aborted) throw error;
        throw new AppError(
          'DEPLOY_TOOL_MISSING',
          'Could not download Tizen tools. Check the internet connection and retry.',
        );
      }
    }
    const sdb = prepared?.sdb ?? tools.sdb!;
    const tizen = tools.tizen!;
    const serial = `${request.address}:${TIZEN_PORT}`;

    this.step('connecting');
    const connect = await this.run(sdb, ['connect', serial], signal, 20_000);
    if (connect.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(connect));
    if (!/connected to|already connected/i.test(`${connect.stdout}\n${connect.stderr}`))
      throw new AppError('DEPLOY_CONNECT_FAILED', tail(connect));
    const devices = await this.run(sdb, ['devices'], signal, 10_000);
    const line = devices.stdout.split(/\r?\n/).find((l) => l.startsWith(serial));
    const [, status = '', model = ''] = line?.trim().split(/\s+/) ?? [];
    if (!line || status === 'offline') throw new AppError('DEPLOY_CONNECT_FAILED', tail(devices));
    if (/unauthori/i.test(status)) throw new AppError('DEPLOY_UNAUTHORIZED', tail(devices));
    // The tizen CLI addresses a TV by its device name (from `sdb devices`).
    const target = /^[\w.-]{1,64}$/.test(model) ? model : serial;

    this.step('authorizing');
    const duid = await this.run(sdb, ['-s', serial, 'shell', '0', 'getduid'], signal, 15_000);
    const duidValue = /[A-Z0-9]{10,}/.exec(duid.stdout)?.[0] ?? null;
    if (duidValue) this.set({ duid: duidValue });

    this.step('packaging');
    const work = join(this.deps.workDir, 'tizen');
    rmSync(work, { recursive: true, force: true });
    const stage = join(work, 'web');
    const out = join(work, 'out');
    mkdirSync(out, { recursive: true });
    cpSync(webDir, stage, { recursive: true });
    // The TV app finds this PC on its first start (it can be changed in the app); a new `install` marker tells it that
    // this PC has just installed it, so it pairs at once even when its saved token is no longer valid.
    writeFileSync(join(stage, 'server.json'), JSON.stringify({ server, install: String(this.now()) }));
    const pack = automatic
      ? null
      : await this.run(tizen, ['package', '-t', 'wgt', '-s', request.profile, '-o', out, '--', stage], signal, 180_000);
    if (prepared) {
      signal.throwIfAborted();
      (this.deps.packageTizen ?? packageTizen)(
        stage,
        join(out, 'Adrenaline.wgt'),
        join(this.deps.workDir, 'author.json'),
        prepared.certificates,
      );
    }
    const wgt = existsSync(out) ? readdirSync(out).find((f) => f.endsWith('.wgt')) : undefined;
    if (!wgt) {
      const text = `${pack?.stdout ?? ''}\n${pack?.stderr ?? ''}`;
      throw new AppError(
        /profile|certificate|password|signing|sign/i.test(text) ? 'DEPLOY_CERTIFICATE' : 'DEPLOY_INSTALL_FAILED',
        tail(pack),
      );
    }

    this.step('installing');
    let install: RunResult;
    if (automatic) {
      const remote = '/home/owner/share/tmp/sdk_tools/tmp/Adrenaline.wgt';
      const installWidget = async () => {
        const push = await this.run(sdb, ['-s', serial, 'push', join(out, wgt), remote], signal, 120_000);
        if (push.code !== 0 || /error|failed/i.test(`${push.stdout}\n${push.stderr}`))
          throw new AppError('DEPLOY_INSTALL_FAILED', tail(push));
        return this.run(
          sdb,
          ['-s', serial, 'shell', '0', 'vd_appinstall', manifest.tizen.appId, remote],
          signal,
          300_000,
        );
      };
      install = await installWidget();
      if (/invalid certificate chain/i.test(`${install.stdout}\n${install.stderr}`) && prepared) {
        signal.throwIfAborted();
        this.deps.log.info('deploy: TV rejected the new SDK chain; retrying once with the legacy SDK distributor');
        (this.deps.packageTizen ?? packageTizen)(
          stage,
          join(out, wgt),
          join(this.deps.workDir, 'author.json'),
          prepared.certificates,
          true,
        );
        install = await installWidget();
      }
    } else {
      install = await this.run(tizen, ['install', '-n', wgt, '-t', target, '--', out], signal, 300_000);
    }
    const installOut = `${install.stdout}\n${install.stderr}`;
    if (
      install.code !== 0 ||
      !/installed the package|install completed|installing\.\.\..*100%/is.test(installOut) ||
      /fail/i.test(installOut)
    ) {
      if (install.timedOut) throw new AppError('DEPLOY_TIMEOUT', tail(install));
      if (/author|distributor|certificate|signature|privilege level/i.test(installOut))
        throw new AppError('DEPLOY_CERTIFICATE', tail(install));
      if (/storage|space/i.test(installOut)) throw new AppError('DEPLOY_NO_SPACE', tail(install));
      throw new AppError('DEPLOY_INSTALL_FAILED', tail(install));
    }

    this.step('launching');
    const launchedAt = this.now();
    // Some firmwares refuse remote launch: then the user opens the app from the TV's app list (handshake waits).
    await this.run(sdb, ['-s', serial, 'shell', '0', 'execute', manifest.tizen.appId], signal, 20_000).catch(
      () => null,
    );
    await this.handshake(request, launchedAt, signal);
  }
}
