import type { TvService } from '../tv/tv-service';
import type { IpcRegistry } from './register';

export function registerTvHandlers(ipc: IpcRegistry, tv: TvService): void {
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
}
