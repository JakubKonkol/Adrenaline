import type { UpdaterStatus } from '@shared/contracts/app';
import type { Logger } from './logger';
import { redact } from './redact';

/** The part of electron-updater's `autoUpdater` used here (injected for tests). */
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterDeps {
  /** null when the app is not packaged: updates are disabled in dev (04-release-i-autoupdate.md). */
  updater: AppUpdaterLike | null;
  send: (status: UpdaterStatus) => void;
  log: Logger;
  betaUpdates: () => boolean;
  /** Shared shutdown (queue, engine resume data, Jackett, DB) before the installer runs. */
  shutdown: () => Promise<void>;
  firstCheckDelayMs?: number;
  intervalMs?: number;
}

/** Wraps electron-updater (D-04, D-76): check 10 s after start and every 6 h, download in the background. */
export function createUpdater(deps: UpdaterDeps) {
  let status: UpdaterStatus = deps.updater ? { state: 'idle' } : { state: 'disabled' };
  const timers: NodeJS.Timeout[] = [];

  const set = (next: UpdaterStatus) => {
    status = next;
    deps.send(status);
  };

  function wire(u: AppUpdaterLike) {
    u.logger = {
      info: (m: unknown) => deps.log.info(String(m)),
      warn: (m: unknown) => deps.log.warn(String(m)),
      error: (m: unknown) => deps.log.error(String(m)),
      debug: (m: unknown) => deps.log.debug(String(m)),
    };
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => set({ state: 'checking' }));
    u.on('update-available', (info: { version: string }) => set({ state: 'downloading', version: info.version }));
    u.on('update-not-available', () => set({ state: 'idle', checkedAt: Date.now() }));
    u.on('download-progress', (p: { percent: number }) =>
      set({ ...status, state: 'downloading', percent: Math.max(0, Math.min(100, p.percent)) }),
    );
    u.on('update-downloaded', (info: { version: string }) => set({ state: 'ready', version: info.version }));
    u.on('error', (e: Error) => set({ state: 'error', message: redact(e.message ?? 'error') }));
  }

  async function check(): Promise<UpdaterStatus> {
    const u = deps.updater;
    if (!u) return status;
    if (status.state === 'ready' || status.state === 'downloading') return status;
    u.allowPrerelease = deps.betaUpdates();
    try {
      await u.checkForUpdates();
    } catch (error) {
      deps.log.warn('update check failed', error);
      set({ state: 'error', message: redact(error instanceof Error ? error.message : String(error)) });
    }
    return status;
  }

  return {
    status: () => status,
    check,
    start() {
      const u = deps.updater;
      if (!u) return;
      wire(u);
      timers.push(setTimeout(() => void check(), deps.firstCheckDelayMs ?? 10_000));
      timers.push(setInterval(() => void check(), deps.intervalMs ?? 6 * 60 * 60 * 1000));
    },
    stop() {
      for (const t of timers.splice(0)) clearTimeout(t);
    },
    /** Saves state through the shared shutdown, then runs the installer and restarts the app. */
    async install(): Promise<boolean> {
      const u = deps.updater;
      if (!u || status.state !== 'ready') return false;
      await deps.shutdown();
      u.quitAndInstall(false, true);
      return true;
    },
  };
}

export type Updater = ReturnType<typeof createUpdater>;
