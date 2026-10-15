import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, type BrowserWindow, ipcMain, shell } from 'electron';
import electronUpdater from 'electron-updater';
import type { EngineStatus } from '@shared/contracts/app';
import { setupEngine } from './engine/setup';
import { createEventSender } from './events';
import { createIpcRegistry } from './ipc/register';
import { createLifecycle } from './lifecycle';
import { createFileLogger } from './logger';
import { appPaths } from './paths';
import { createTrustedUrlCheck, hardenSession } from './security';
import { createUpdater } from './updater';
import { createMainWindow } from './window';

// Dev and tests only: a separate profile directory (never in the installed app).
const userDataOverride = process.env['ADRENALINE_USER_DATA'];
if (userDataOverride && !app.isPackaged) app.setPath('userData', userDataOverride);

app.setAppUserModelId('com.jakubkonkol.adrenaline');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const logsDir = join(app.getPath('userData'), 'logs');
  const log = createFileLogger({ dir: logsDir, homeDir: homedir(), mirror: !app.isPackaged });
  log.info(`Adrenaline ${__ADRENALINE_VERSION__} starting (Electron ${process.versions.electron})`);
  process.on('uncaughtException', (error) => log.error('uncaught exception', error));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));

  let mainWindow: BrowserWindow | null = null;
  const isTrusted = createTrustedUrlCheck({
    indexHtmlPath: appPaths.rendererIndex,
    devUrl: appPaths.devRendererUrl(),
  });
  const send = createEventSender(() => mainWindow);
  const lifecycle = createLifecycle({ log: log.child('shutdown') });

  const engine = setupEngine({
    userDataDir: app.getPath('userData'),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    env: process.env,
    clientVersion: __ADRENALINE_VERSION__,
    listenPort: () => 0,
    log,
  });
  const engineStatus = (): EngineStatus =>
    engine.supervisor
      ? { ...engine.supervisor.status, ...(engine.fake ? { fake: true } : {}) }
      : { state: 'unavailable', message: 'ENGINE_UNAVAILABLE' };
  engine.supervisor?.on('status', () => send('engine:status', engineStatus()));

  lifecycle.addStep('engine', () => engine.supervisor?.stop(), 13_000);
  lifecycle.addStep('log', () => log.flush(), 1_000);

  const updater = createUpdater({
    updater: app.isPackaged ? electronUpdater.autoUpdater : null,
    send: (status) => send('updater:status', status),
    log: log.child('updater'),
    betaUpdates: () => false,
    shutdown: () => lifecycle.shutdown(),
  });

  const showWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow(isTrusted);
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  app.on('second-instance', showWindow);

  void app.whenReady().then(() => {
    hardenSession({ dev: appPaths.devRendererUrl() !== null });
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
    updater.start();
    showWindow();
    void engine.supervisor?.start();
  });

  // Every quit path (window close, updater, tray "Quit") goes through the shared shutdown first.
  app.on('before-quit', (event) => {
    if (lifecycle.isDone) return;
    event.preventDefault();
    updater.stop();
    void lifecycle.shutdown().finally(() => app.quit());
  });

  app.on('window-all-closed', () => app.quit());
}
