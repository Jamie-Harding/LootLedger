-- 0007_add_missing_open_tasks_columns.sql
-- Add missing columns to open_tasks table

ALTER TABLE open_tasks ADD COLUMN etag TEXT;
ALTER TABLE open_tasks ADD COLUMN sort_order INTEGER;
ALTER TABLE open_tasks ADD COLUMN updated_ts INTEGER;
ALTER TABLE open_tasks ADD COLUMN last_seen_ts INTEGER;

-- Set last_seen_ts for existing rows
UPDATE open_tasks SET last_seen_ts = strftime('%s','now') WHERE last_seen_ts IS NULL;
