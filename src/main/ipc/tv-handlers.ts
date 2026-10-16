import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, dialog } from 'electron';
import type { TvToolchain } from '@shared/contracts/tv';
import { AppError } from '@shared/errors';
import { mainText } from '../i18n';
import type { SettingsService } from '../services/settings-service';
import type { DeployService } from '../tv/deploy/deploy-service';
import type { TvService } from '../tv/tv-service';
import type { IpcRegistry } from './register';

export function registerTvHandlers(
  ipc: IpcRegistry,
  deps: {
    tv: TvService;
    deploy: DeployService;
    settings: SettingsService;
    toolchain: () => TvToolchain;
    window: () => BrowserWindow | null;
  },
): void {
  const { tv, deploy } = deps;
  ipc.handle('tv:status', () => tv.status());
  ipc.handle('tv:approve', ({ id }) => {
    tv.approve(id);
    return tv.status();
  });
  ipc.handle('tv:deny', ({ id }) => {
    tv.deny(id);
    return tv.status();
  });
  ipc.handle('tv:revoke', ({ deviceId }) => {
    tv.revoke(deviceId);
    return tv.status();
  });
  ipc.handle('tv:toolchain', () => deps.toolchain());
  ipc.handle('tv:chooseTool', async ({ tool }) => {
    const win = deps.window();
    const options: Electron.OpenDialogOptions =
      tool === 'adb'
        ? {
            title: mainText.dialog.chooseAdb,
            properties: ['openFile'],
            filters: [{ name: 'adb', extensions: ['exe'] }],
          }
        : { title: mainText.dialog.chooseTizenStudio, properties: ['openDirectory'] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const path = result.canceled ? null : (result.filePaths[0] ?? null);
    if (path) {
      if (tool === 'adb') {
        if (!/adb(\.exe)?$/i.test(path)) throw new AppError('DEPLOY_TOOL_MISSING', 'adb');
        deps.settings.update({ tvAdbPath: path });
      } else {
        if (!existsSync(join(path, 'tools', process.platform === 'win32' ? 'sdb.exe' : 'sdb')))
          throw new AppError('DEPLOY_TOOL_MISSING', 'tizen-studio');
        deps.settings.update({ tvTizenStudioPath: path });
      }
    }
    return deps.toolchain();
  });
  ipc.handle('tv:deploy', (request) => {
    if (request.platform === 'tizen') deps.settings.update({ tvTizenProfile: request.profile });
    return deploy.start(request);
  });
  ipc.handle('tv:deployCancel', () => deploy.cancel());
  ipc.handle('tv:deployState', () => deploy.state);
}
