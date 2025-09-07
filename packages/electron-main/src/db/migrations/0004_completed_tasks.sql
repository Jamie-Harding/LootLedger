-- 0004_completed_tasks.sql
-- Create a mirror table for completed tasks

CREATE TABLE IF NOT EXISTS completed_tasks (
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  project_id TEXT,
  list TEXT,
  due_ts INTEGER,
  completed_ts INTEGER NOT NULL,
  is_recurring INTEGER DEFAULT 0,
  series_key TEXT,
  PRIMARY KEY (task_id, completed_ts)
);

CREATE INDEX IF NOT EXISTS idx_completed_tasks_completed_ts
  ON completed_tasks (completed_ts DESC);
