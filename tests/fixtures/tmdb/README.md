# TMDB fixtures

**Synthetic contract data**, not recorded live responses. The names and IDs of the two movies exist to tell the release years apart; overviews and poster paths are test values. The TV show and its episodes are our own fictional data. Tests never download images or movies.

Contract checked against the TMDB documentation (2026-10-15):
- [Authentication](https://developer.themoviedb.org/docs/authentication-application): Bearer token or the `api_key` parameter.
- [Movie search](https://developer.themoviedb.org/reference/search-movie), [TV search](https://developer.themoviedb.org/reference/search-tv): `results`, `title`/`name`, `original_title`/`original_name`, `release_date`/`first_air_date`, `poster_path`, `popularity`.
- [Movie details](https://developer.themoviedb.org/reference/movie-details), [TV details](https://developer.themoviedb.org/reference/tv-series-details): genres, runtime / episode_run_time, seasons; `append_to_response=external_ids`.
- [Seasons](https://developer.themoviedb.org/reference/tv-season-details): `episodes`, `season_number`, `episode_number`, `air_date`.
- [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting): HTTP 429 is handled. Tests supply a synthetic `Retry-After`; TMDB is not assumed to always send it.

`node scripts/live/tmdb.mjs` reads `TMDB_TOKEN` from `.env` and saves trimmed responses to `live/` (git-ignored). It never overwrites the deterministic contract data. Verified responses can be moved into the fixtures later, together with a note on where they came from. The script does not provoke a 429 by flooding the API; that case is simulated offline.

The official logo in `src/renderer/assets/brand/tmdb.svg` was downloaded unmodified from the [TMDB brand assets](https://www.themoviedb.org/about/logos-attribution), file `blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg`.
