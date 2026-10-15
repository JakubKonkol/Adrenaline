import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, type BrowserWindow, ipcMain, nativeTheme, Notification, safeStorage, shell } from 'electron';
import electronUpdater from 'electron-updater';
import type { EngineStatus } from '@shared/contracts/app';
import { setupEngine } from './engine/setup';
import { createEventSender } from './events';
import { mainText } from './i18n';
import { createIpcRegistry } from './ipc/register';
import { registerSettingsHandlers } from './ipc/settings-handlers';
import { registerCatalogHandlers } from './ipc/catalog-handlers';
import { registerSourcesHandlers } from './ipc/sources-handlers';
import { registerDownloadsHandlers } from './ipc/downloads-handlers';
import { JobsRepository } from './persistence/repositories/jobs';
import { DownloadService } from './services/download-service';
import { JackettManager } from './jackett/jackett-manager';
import { SourcesRepository } from './persistence/repositories/sources';
import { TorznabClient } from './providers/torznab/torznab-client';
import { ReleaseSearchService } from './services/release-search-service';
import { SourcesService } from './services/sources-service';
import { TmdbClient } from './providers/tmdb/tmdb-client';
import { CacheRepository } from './persistence/repositories/cache';
import { MediaRepository } from './persistence/repositories/media';
import { CatalogService } from './services/catalog-service';
import { createLifecycle } from './lifecycle';
import { createFileLogger } from './logger';
import { openDatabase } from './persistence/db';
import { appPaths } from './paths';
import { Secrets } from './secrets';
import { createTrustedUrlCheck, hardenSession } from './security';
import { randomListenPort, SettingsService } from './services/settings-service';
import { type AppTray, createTray } from './tray';
import { createUpdater } from './updater';
import { createMainWindow } from './window';

// Dev and tests only: a separate profile directory (never in the installed app).
const userDataOverride = process.env['ADRENALINE_USER_DATA'];
if (userDataOverride && !app.isPackaged) app.setPath('userData', userDataOverride);

app.setAppUserModelId('com.jakubkonkol.adrenaline');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const userData = app.getPath('userData');
  const logsDir = join(userData, 'logs');
  const log = createFileLogger({ dir: logsDir, homeDir: homedir(), mirror: !app.isPackaged });
  log.info(`Adrenaline ${__ADRENALINE_VERSION__} starting (Electron ${process.versions.electron})`);
  process.on('uncaughtException', (error) => log.error('uncaught exception', error));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

  const db = openDatabase(join(userData, 'adrenaline.db'), { log: log.child('db') });
  const settings = new SettingsService(db, {
    downloadDir: join(app.getPath('videos'), 'Adrenaline'),
    randomPort: randomListenPort,
  });
  nativeTheme.themeSource = settings.get().theme;

  let mainWindow: BrowserWindow | null = null;
  let tray: AppTray | null = null;
  let quitting = false;
  let downloadService: DownloadService | null = null;
  const isTrusted = createTrustedUrlCheck({
    indexHtmlPath: appPaths.rendererIndex,
    devUrl: appPaths.devRendererUrl(),
  });
  const send = createEventSender(() => mainWindow);
  const lifecycle = createLifecycle({ log: log.child('shutdown') });

  const engine = setupEngine({
    userDataDir: userData,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    env: process.env,
    clientVersion: __ADRENALINE_VERSION__,
    listenPort: () => settings.get().listenPort,
    log,
  });
  const engineStatus = (): EngineStatus =>
    engine.supervisor
      ? { ...engine.supervisor.status, ...(engine.fake ? { fake: true } : {}) }
      : { state: 'unavailable', message: 'ENGINE_UNAVAILABLE' };
  const applyEngineLimits = () => {
    const s = settings.get();
    engine.supervisor
      ?.request('setLimits', { downloadBps: s.downloadLimitKBps * 1024, uploadBps: s.uploadLimitKBps * 1024 })
      .catch((error: unknown) => log.warn('setLimits failed', error));
  };
  engine.supervisor?.on('status', () => send('engine:status', engineStatus()));
  engine.supervisor?.on('ready', applyEngineLimits);

  settings.on('changed', ({ patch }) => {
    if (patch.theme) nativeTheme.themeSource = patch.theme;
    if (patch.downloadLimitKBps !== undefined || patch.uploadLimitKBps !== undefined) applyEngineLimits();
  });

  lifecycle.addStep('engine', () => engine.supervisor?.stop(), 13_000);
  lifecycle.addStep('database', () => db.close(), 1_000);
  lifecycle.addStep('log', () => log.flush(), 1_000);

  const updater = createUpdater({
    updater: app.isPackaged ? electronUpdater.autoUpdater : null,
    send: (status) => send('updater:status', status),
    log: log.child('updater'),
    betaUpdates: () => settings.get().betaUpdates,
    shutdown: () => lifecycle.shutdown(),
  });

  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow(isTrusted);
      // D-71: closing the window hides it to the tray (once with a notice); "Quit" in the tray exits.
      mainWindow.on('close', (event) => {
        if (quitting || !settings.get().closeToTray || !tray) return;
        event.preventDefault();
        mainWindow?.hide();
        if (!settings.get().trayNoticeShown) {
          settings.update({ trayNoticeShown: true });
          if (Notification.isSupported()) {
            new Notification({ title: mainText.notice.trayTitle, body: mainText.notice.trayBody }).show();
          }
        }
      });
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', showWindow);

  void app.whenReady().then(() => {
    hardenSession({ dev: appPaths.devRendererUrl() !== null });
    const secrets = new Secrets(db, safeStorage, log.child('secrets'));
    const ipc = createIpcRegistry({
      ipcMain,
      isTrustedSender: isTrusted,
      onError: (channel, error) => log.error(`ipc ${channel} failed`, error),
    });
    ipc.handle('app:version', () => __ADRENALINE_VERSION__);
    ipc.handle('app:updaterStatus', () => updater.status());
    ipc.handle('app:checkForUpdates', () => updater.check());
    ipc.handle('app:installUpdate', () => updater.install());
    ipc.handle('app:openLogsFolder', async () => {
      await shell.openPath(logsDir);
    });
    ipc.handle('app:engineStatus', () => engineStatus());
    ipc.handle('app:restartEngine', async () => {
      await engine.supervisor?.restart();
      return engineStatus();
    });
    registerSettingsHandlers(ipc, { settings, secrets, window: () => mainWindow });
    const tmdb = new TmdbClient({ token: () => secrets.get('tmdb.token') });
    const catalog = new CatalogService(tmdb, new CacheRepository(db), new MediaRepository(db));
    registerCatalogHandlers(ipc, catalog, tmdb);

    // Sources (etap 5): bundled Jackett (resources/jackett, dev: vendor/jackett) + user Torznab endpoints.
    const jackett = new JackettManager({
      exePath: app.isPackaged
        ? join(process.resourcesPath, 'jackett', 'JackettConsole.exe')
        : join(app.getAppPath(), 'vendor', 'jackett', 'JackettConsole.exe'),
      dataDir: join(userData, 'jackett'),
      secrets,
      log: log.child('jackett'),
      disabled: !app.isPackaged && process.env['ADRENALINE_NO_JACKETT'] === '1',
    });
    const torznab = new TorznabClient();
    const sources = new SourcesService({
      repo: new SourcesRepository(db),
      jackett,
      secrets,
      torznab,
      log: log.child('sources'),
    });
    jackett.on('status', (status) => {
      if (status.state === 'restarting') sources.resetSync();
      send('jackett:status', status);
    });
    const releaseSearch = new ReleaseSearchService({
      sources,
      torznab,
      cache: new CacheRepository(db),
      log: log.child('releases'),
    });
    releaseSearch.on('update', (session) => send('releases:update', session));
    registerSourcesHandlers(ipc, { sources, search: releaseSearch, jackett });

    // Downloads (etap 6). The service follows the engine (restores jobs on every engine start).
    if (engine.supervisor) {
      const downloads = new DownloadService({
        jobs: new JobsRepository(db),
        engine: engine.supervisor,
        settings,
        releaseInfo: (sessionId, releaseId) => releaseSearch.downloadInfo(sessionId, releaseId),
        endpointFor: (id) => sources.endpointFor(id),
        log: log.child('downloads'),
        shell,
      });
      downloadService = downloads;
      downloads.on('changed', (job) => send('downloads:changed', job));
      downloads.on('progress', (p) => send('downloads:progress', p));
      registerDownloadsHandlers(ipc, downloads, { devApi: !app.isPackaged && engine.fake !== null });
      settings.on('changed', ({ patch }) => {
        if (patch.maxActiveDownloads !== undefined) void downloads.schedule();
      });
      lifecycle.addStep('downloads', () => downloads.persistAll(), 1_000);
      // Tray tooltip with the total speed (etap 6.5).
      const tooltip = setInterval(() => {
        const { down, up, active } = downloads.totals();
        const mb = (b: number) => (b / 1024 / 1024).toFixed(1).replace('.', ',');
        tray?.setTooltip(
          active > 0 || down > 0 || up > 0 ? `Adrenaline — ↓ ${mb(down)} MB/s ↑ ${mb(up)} MB/s` : 'Adrenaline',
        );
      }, 2_000);
      lifecycle.addStep('tooltip', () => clearInterval(tooltip), 100);
    }

    lifecycle.addStep('jackett', () => jackett.stop(), 6_000);
    // Started in the background shortly after launch when a built-in source is enabled, otherwise on demand.
    if (sources.list().some((s) => s.kind === 'jackett_builtin' && s.enabled)) {
      setTimeout(() => void jackett.ensureRunning().catch((e: unknown) => log.warn('jackett start failed', e)), 5_000);
    }

    tray = createTray({
      show: showWindow,
      pauseAll: () => void downloadService?.pauseAll(),
      resumeAll: () => void downloadService?.resumeAll(),
      quit: () => app.quit(),
    });
    lifecycle.addStep('tray', () => tray?.destroy(), 500);

    updater.start();
    showWindow();
    void engine.supervisor?.start();
  });

  // Every quit path (tray "Quit", updater, OS shutdown) goes through the shared shutdown first.
  app.on('before-quit', (event) => {
    quitting = true;
    if (lifecycle.isDone) return;
    event.preventDefault();
    updater.stop();
    void lifecycle.shutdown().finally(() => app.quit());
  });

  app.on('window-all-closed', () => {
    if (!tray || !settings.get().closeToTray) app.quit();
  });
}
