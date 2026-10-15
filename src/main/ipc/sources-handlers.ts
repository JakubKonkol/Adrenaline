import type { JackettManager } from '../jackett/jackett-manager';
import type { ReleaseSearchService } from '../services/release-search-service';
import type { SourcesService } from '../services/sources-service';
import type { IpcRegistry } from './register';

export function registerSourcesHandlers(
  ipc: IpcRegistry,
  deps: { sources: SourcesService; search: ReleaseSearchService; jackett: JackettManager },
): void {
  ipc.handle('releases:startSearch', ({ target, refresh }) => ({
    sessionId: deps.search.start(target, refresh ?? false),
  }));
  ipc.handle('releases:cancelSearch', ({ sessionId }) => deps.search.cancel(sessionId));
  ipc.handle('releases:session', ({ sessionId }) => deps.search.session(sessionId));
  ipc.handle('sources:list', () => deps.sources.list());
  ipc.handle('sources:setEnabled', ({ id, enabled }) => deps.sources.setEnabled(id, enabled));
  ipc.handle('sources:test', ({ id }) => deps.sources.test(id));
  ipc.handle('sources:addCustom', (input) => deps.sources.addCustom(input));
  ipc.handle('sources:remove', ({ id }) => deps.sources.remove(id));
  ipc.handle('sources:jackettStatus', () => deps.jackett.status);
  ipc.handle('sources:restartJackett', async () => {
    deps.sources.resetSync();
    await deps.jackett.restart().catch(() => undefined);
    return deps.jackett.status;
  });
}
