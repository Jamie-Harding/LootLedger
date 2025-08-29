-- 0003_oauth_and_sync_state.sql
BEGIN;

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Seed defaults
INSERT OR IGNORE INTO app_state(key, value) VALUES
  ('auth_status', 'signed_out'),
  ('last_sync_at', '0'),
  ('sync_enabled', '1'),
  ('sync_backoff_ms', '0');

COMMIT;
