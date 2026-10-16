-- 003: ffprobe results of library files (D-85). A row is valid while size and mtime of the file match.

CREATE TABLE media_probe (
  item_id TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  parser_version INTEGER NOT NULL,
  probe_json TEXT NOT NULL,
  probed_at INTEGER NOT NULL
);
