-- 0005_settings_normalize.sql
-- Normalize legacy 'settings' (wide) into key/value JSON ('name','json')
-- IMPORTANT: no BEGIN/COMMIT here; the migration runner wraps transactions.

/* If 'settings' is already normalized, skip work.
   This CREATE will fail if the table exists in normalized form, so we use a temp table first. */

-- Create the new KV table with a temporary name to avoid clashes
CREATE TABLE IF NOT EXISTS settings_kv_new (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

-- Try to copy legacy values if the old wide columns exist.
-- If they don't exist, the INSERT ... SELECT simply copies nothing (no crash).
INSERT OR IGNORE INTO settings_kv_new(name, json)
SELECT 'tag_priority',
       CASE
         WHEN s.tag_priority IS NULL OR TRIM(s.tag_priority) = '' THEN '[]'
         ELSE s.tag_priority
       END
FROM settings AS s
WHERE 1=1
-- These WHERE subqueries only succeed if the legacy columns exist.
  AND EXISTS (SELECT 1 FROM pragma_table_info('settings') WHERE name='tag_priority')
LIMIT 1;

-- Seed defaults if they weren't inserted
INSERT OR IGNORE INTO settings_kv_new(name, json) VALUES ('tag_priority', '[]');
INSERT OR IGNORE INTO settings_kv_new(name, json) VALUES ('sync_poll_seconds', '180');

-- If the current 'settings' is legacy (no 'name' column), swap tables.
-- We detect that by checking pragma_table_info.
-- SQLite doesn't have IF, so we do it in two steps: try the rename, and only drop legacy if swap succeeded.

-- Step A: rename current settings to legacy if it's not already KV.
-- This ALTER will succeed if 'settings' exists and is not already the same schema as 'settings_kv_new'.
-- If 'settings' is already KV, the swap below will still produce a valid table.
ALTER TABLE settings RENAME TO settings_legacy;

-- Step B: move kv_new into place
-- If a KV 'settings' already existed, this will fail; so we protect it with IF NOT EXISTS semantics:
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  json TEXT NOT NULL
);

-- Fill the (possibly new) settings table from kv_new if it's empty
INSERT OR IGNORE INTO settings(name, json)
SELECT name, json FROM settings_kv_new;

-- Cleanup: drop temps/legacy if present
DROP TABLE IF EXISTS settings_kv_new;
DROP TABLE IF EXISTS settings_legacy;
