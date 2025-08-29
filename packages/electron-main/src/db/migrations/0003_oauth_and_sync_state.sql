-- 0003_oauth_and_sync_state.sql  (no BEGIN/COMMIT)
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Seed defaults (idempotent)
INSERT INTO app_state (key, value) VALUES ('auth_status','signed_out')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO app_state (key, value) VALUES ('last_sync_at','0')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO app_state (key, value) VALUES ('sync_enabled','1')
  ON CONFLICT(key) DO NOTHING;
INSERT INTO app_state (key, value) VALUES ('sync_backoff_ms','0')
  ON CONFLICT(key) DO NOTHING;
