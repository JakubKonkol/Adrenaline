-- 001: initial schema (01-architektura.md, "Model danych").

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE secrets (
  name TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('jackett_builtin', 'torznab_custom')),
  name TEXT NOT NULL,
  endpoint TEXT,
  indexer_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  api_key_secret TEXT,
  health TEXT NOT NULL DEFAULT 'unknown' CHECK (health IN ('unknown', 'ok', 'error')),
  health_message TEXT,
  checked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE media_items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('movie', 'tv')),
  tmdb_id INTEGER NOT NULL,
  imdb_id TEXT,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  poster_path TEXT,
  UNIQUE (type, tmdb_id)
);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY,
  media_item_id INTEGER NOT NULL REFERENCES media_items (id) ON DELETE CASCADE,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  tmdb_episode_id INTEGER,
  title TEXT,
  UNIQUE (media_item_id, season, episode)
);

CREATE TABLE download_jobs (
  id TEXT PRIMARY KEY,
  media_item_id INTEGER REFERENCES media_items (id),
  episode_id INTEGER REFERENCES episodes (id),
  target_json TEXT NOT NULL,
  release_json TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('magnet', 'torrent')),
  magnet TEXT,
  torrent_blob BLOB,
  info_hash_v1 TEXT,
  info_hash_v2 TEXT,
  save_dir TEXT NOT NULL,
  state TEXT NOT NULL,
  pause_reason TEXT,
  resume_state TEXT,
  error_code TEXT,
  error_message TEXT,
  total_bytes INTEGER,
  done_bytes INTEGER NOT NULL DEFAULT 0,
  seed_ratio_limit REAL,
  seed_time_limit_min INTEGER,
  subtitle_lang TEXT,
  subtitle_fallback_lang TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- BR07: one active job per torrent.
CREATE UNIQUE INDEX download_jobs_v1_active ON download_jobs (info_hash_v1)
  WHERE info_hash_v1 IS NOT NULL AND info_hash_v1 != '' AND state != 'removed';
CREATE UNIQUE INDEX download_jobs_v2_active ON download_jobs (info_hash_v2)
  WHERE info_hash_v2 IS NOT NULL AND info_hash_v2 != '' AND state != 'removed';

CREATE TABLE download_files (
  job_id TEXT NOT NULL REFERENCES download_jobs (id) ON DELETE CASCADE,
  file_index INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  selected INTEGER NOT NULL DEFAULT 0,
  done_bytes INTEGER NOT NULL DEFAULT 0,
  episode_id INTEGER REFERENCES episodes (id),
  PRIMARY KEY (job_id, file_index)
);

CREATE TABLE subtitle_tasks (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES download_jobs (id) ON DELETE CASCADE,
  file_index INTEGER,
  lang TEXT NOT NULL,
  state TEXT NOT NULL,
  candidate_json TEXT,
  candidates_json TEXT,
  match_confidence TEXT,
  target_path TEXT,
  error_code TEXT,
  error_message TEXT,
  quota_reset_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX subtitle_tasks_job ON subtitle_tasks (job_id);

CREATE TABLE cache (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX cache_expires ON cache (expires_at);
