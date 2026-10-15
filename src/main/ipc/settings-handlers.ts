import { dialog, type BrowserWindow } from 'electron';
import { type SecretsStatus, USER_SECRET_NAMES } from '@shared/contracts/settings';
import { checkWritable } from '../fs/disk-space';
import { mainText } from '../i18n';
import type { Secrets } from '../secrets';
import type { SettingsService } from '../services/settings-service';
import type { IpcRegistry } from './register';

export interface SettingsHandlerDeps {
  settings: SettingsService;
  secrets: Secrets;
  window: () => BrowserWindow | null;
}

export function secretsStatus(secrets: Secrets): SecretsStatus {
  const set = Object.fromEntries(USER_SECRET_NAMES.map((n) => [n, secrets.has(n)])) as SecretsStatus['set'];
  return { encryptionAvailable: secrets.encryptionAvailable, set };
}

export function registerSettingsHandlers(ipc: IpcRegistry, deps: SettingsHandlerDeps): void {
  ipc.handle('settings:get', () => deps.settings.get());

  ipc.handle('settings:update', async (patch) => {
    // FR07: a new download folder must be writable before it is stored.
    if (patch.downloadDir !== undefined && patch.downloadDir !== deps.settings.get().downloadDir) {
      await checkWritable(patch.downloadDir);
    }
    return deps.settings.update(patch);
  });

  ipc.handle('settings:chooseFolder', async ({ defaultPath }) => {
    const win = deps.window();
    const options: Electron.OpenDialogOptions = {
      title: mainText.dialog.chooseFolder,
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath ?? deps.settings.get().downloadDir,
    };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const folder = result.canceled ? null : (result.filePaths[0] ?? null);
    if (folder) await checkWritable(folder);
    return folder;
  });

  ipc.handle('settings:secretsStatus', () => secretsStatus(deps.secrets));

  ipc.handle('settings:setSecret', ({ name, value }) => {
    deps.secrets.set(name, value);
    return secretsStatus(deps.secrets);
  });
}
