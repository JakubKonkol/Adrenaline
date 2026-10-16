/**
 * Public indexers offered by default (D-53). All are off on first start; the user enables them in the wizard or in
 * Settings → Sources. Ids are Jackett indexer ids (checked in v0.24.2856, D-57).
 */
export interface DefaultIndexer {
  id: string;
  name: string;
  description: string;
}

export const DEFAULT_INDEXERS: DefaultIndexer[] = [
  { id: 'yts', name: 'YTS', description: 'Movies, small files in good quality.' },
  { id: 'thepiratebay', name: 'The Pirate Bay', description: 'General index: movies and TV shows.' },
  { id: 'torrentdownloads', name: 'Torrent Downloads', description: 'General index: movies and TV shows.' },
  { id: 'limetorrents', name: 'LimeTorrents', description: 'General index: movies and TV shows.' },
];

export const builtinSourceId = (indexerId: string) => `jackett:${indexerId}`;
export const indexerIdOf = (sourceId: string) => (sourceId.startsWith('jackett:') ? sourceId.slice(8) : null);
