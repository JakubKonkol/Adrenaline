import type { Episode, TitleDetails } from '@shared/contracts/catalog';
import { transaction, type Database } from '../db';

export class MediaRepository {
  constructor(private readonly db: Database) {}

  saveSelection(title: TitleDetails, episode?: Episode): void {
    transaction(this.db, () => {
      const row = this.db
        .prepare(
          `INSERT INTO media_items (type, tmdb_id, imdb_id, title, original_title, year, poster_path)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (type, tmdb_id) DO UPDATE SET
        imdb_id = excluded.imdb_id, title = excluded.title, original_title = excluded.original_title,
        year = excluded.year, poster_path = excluded.poster_path RETURNING id`,
        )
        .get(
          title.type,
          title.tmdbId,
          title.imdbId,
          title.title,
          title.originalTitle,
          title.year,
          title.posterPath,
        ) as { id: number };
      if (episode)
        this.db
          .prepare(
            `INSERT INTO episodes (media_item_id, season, episode, tmdb_episode_id, title)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT (media_item_id, season, episode) DO UPDATE SET
        tmdb_episode_id = excluded.tmdb_episode_id, title = excluded.title`,
          )
          .run(row.id, episode.season, episode.number, episode.tmdbId, episode.title);
    });
  }

  /** Poster and episode title saved when the title was chosen (library, D-80). */
  lookup(type: 'movie' | 'tv', tmdbId: number, season?: number, episode?: number) {
    const item = this.db
      .prepare('SELECT id, poster_path AS posterPath FROM media_items WHERE type = ? AND tmdb_id = ?')
      .get(type, tmdbId) as { id: number; posterPath: string | null } | undefined;
    if (!item) return { posterPath: null, episodeTitle: null };
    const ep =
      season !== undefined && episode !== undefined
        ? (this.db
            .prepare('SELECT title FROM episodes WHERE media_item_id = ? AND season = ? AND episode = ?')
            .get(item.id, season, episode) as { title: string | null } | undefined)
        : undefined;
    return { posterPath: item.posterPath, episodeTitle: ep?.title ?? null };
  }
}
