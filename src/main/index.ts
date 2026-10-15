import { app, type BrowserWindow, ipcMain } from 'electron';
import { createIpcRegistry } from './ipc/register';
import { appPaths } from './paths';
import { createTrustedUrlCheck, hardenSession } from './security';
import { createMainWindow } from './window';

// Dev and tests only: a separate profile directory (never in the installed app).
const userDataOverride = process.env['ADRENALINE_USER_DATA'];
if (userDataOverride && !app.isPackaged) app.setPath('userData', userDataOverride);

app.setAppUserModelId('com.jakubkonkol.adrenaline');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const isTrusted = createTrustedUrlCheck({
    indexHtmlPath: appPaths.rendererIndex,
    devUrl: appPaths.devRendererUrl(),
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
    const ipc = createIpcRegistry({ ipcMain, isTrustedSender: isTrusted });
    ipc.handle('app:version', () => __ADRENALINE_VERSION__);
    showWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
