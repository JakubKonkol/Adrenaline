import type { LibraryService } from '../services/library-service';
import type { IpcRegistry } from './register';

export function registerLibraryHandlers(ipc: IpcRegistry, library: LibraryService): void {
  ipc.handle('library:list', () => library.list());
  ipc.handle('library:play', ({ id }) => library.play(id));
  ipc.handle('library:showInFolder', ({ id }) => library.showInFolder(id));
  ipc.handle('library:remove', ({ id, deleteFiles }) => library.remove(id, deleteFiles));
}
