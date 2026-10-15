import type { TmdbClient } from '../providers/tmdb/tmdb-client';
import type { CatalogService } from '../services/catalog-service';
import type { IpcRegistry } from './register';

export function registerCatalogHandlers(ipc: IpcRegistry, catalog: CatalogService, client: TmdbClient): void {
  ipc.handle('catalog:search', ({ query, type }) => catalog.search(query, type));
  ipc.handle('catalog:details', ({ type, tmdbId }) => catalog.details(type, tmdbId));
  ipc.handle('catalog:season', ({ tmdbId, season }) => catalog.season(tmdbId, season));
  ipc.handle('catalog:select', (input) => catalog.select(input));
  ipc.handle('settings:testTmdb', () => client.test());
}
