-- 002: TV clients (1.0, docs/1.0-adrenaline-tv/02-architecture-and-api.md). Additive only: 0.9.0 data is untouched.

-- Paired TVs. Only a SHA-256 hash of the device token is stored; revoking deletes the row.
CREATE TABLE tv_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'tizen', 'web')),
  token_hash TEXT NOT NULL UNIQUE,
  client_version TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  last_address TEXT
);

-- Where each TV stopped watching a library item (`<jobId>~<fileIndex>`).
CREATE TABLE playback_progress (
  device_id TEXT NOT NULL REFERENCES tv_devices (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  position_ms INTEGER NOT NULL,
  duration_ms INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, item_id)
);

-- Stable identity of this PC as a TV server (shown to TVs, survives restarts and address changes).
CREATE TABLE tv_server (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_id TEXT NOT NULL
);
