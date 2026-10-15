import { createHash } from 'node:crypto';
import type { DownloadService } from '../services/download-service';
import type { IpcRegistry } from './register';

export function registerDownloadsHandlers(
  ipc: IpcRegistry,
  downloads: DownloadService,
  opts: { devApi: boolean },
): void {
  ipc.handle('downloads:preflight', ({ ref, options }) => downloads.preflight(ref, options ?? {}));
  ipc.handle('downloads:create', ({ ref, options }) => downloads.create(ref, options));
  ipc.handle('downloads:list', () => downloads.list());
  ipc.handle('downloads:get', ({ jobId }) => downloads.get(jobId));
  ipc.handle('downloads:progress', () => downloads.progressSnapshot());
  ipc.handle('downloads:selectFiles', ({ jobId, indices }) => downloads.selectFiles(jobId, indices));
  ipc.handle('downloads:pause', ({ jobId }) => downloads.pause(jobId));
  ipc.handle('downloads:resume', ({ jobId }) => downloads.resume(jobId));
  ipc.handle('downloads:remove', ({ jobId, deleteFiles }) => downloads.remove(jobId, deleteFiles));
  ipc.handle('downloads:openFolder', ({ jobId }) => downloads.openFolder(jobId));
  ipc.handle('downloads:recheck', ({ jobId }) => downloads.recheck(jobId));
  if (opts.devApi) {
    // Fake magnet for the FakeEngine (smoke test, manual UI checks); never registered in the installed app.
    ipc.handle('dev:addTestDownload', ({ name }) => {
      const hash = createHash('sha1').update(name).digest('hex');
      const release = `${name}.2024.1080p.WEB-DL`;
      return downloads.createDirect(
        { kind: 'movie', tmdbId: 1, title: name, originalTitle: name, year: 2024 },
        `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(release)}`,
        release,
      );
    });
  }
}
