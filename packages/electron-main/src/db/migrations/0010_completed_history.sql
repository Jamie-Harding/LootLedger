-- 1) New table with surrogate PK and natural uniqueness on (task_id, completed_ts)
CREATE TABLE IF NOT EXISTS completed_tasks_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  project_id TEXT,
  list TEXT,
  due_ts INTEGER,
  completed_ts INTEGER NOT NULL,
  is_recurring INTEGER NOT NULL DEFAULT 0,
  series_key TEXT,
  verified INTEGER NOT NULL DEFAULT 1,
  revoked INTEGER NOT NULL DEFAULT 0,
  revoked_ts INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_completed_taskid_ts
  ON completed_tasks_v2 (task_id, completed_ts);

CREATE INDEX IF NOT EXISTS idx_completed_active_ts
  ON completed_tasks_v2 (revoked ASC, completed_ts DESC);

-- 2) Copy old data (handles both pre- and post-revocation migrations)
-- First ensure verified column exists (this will fail silently if it already exists)
ALTER TABLE completed_tasks ADD COLUMN verified INTEGER NOT NULL DEFAULT 1;

INSERT INTO completed_tasks_v2 (
  task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key, verified, revoked, revoked_ts
)
SELECT
  task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key,
  COALESCE(verified, 1),
  COALESCE(revoked, 0),
  revoked_ts
FROM completed_tasks;

-- 3) Swap tables
ALTER TABLE completed_tasks RENAME TO completed_tasks_backup;
ALTER TABLE completed_tasks_v2 RENAME TO completed_tasks;

-- (Optional) keep backup for a version or two; drop later after you're confident
-- DROP TABLE completed_tasks_backup;
