-- Quarantine mirror: tasks that disappeared from open snapshot but were NOT confirmed as completed
CREATE TABLE IF NOT EXISTS removed_tasks (
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  project_id TEXT,
  list TEXT,
  due_ts INTEGER,
  removed_ts INTEGER NOT NULL,  -- when we observed disappearance
  reason TEXT NOT NULL,         -- 'deleted_or_moved' | 'unknown'
  PRIMARY KEY (task_id, removed_ts)
);

CREATE INDEX IF NOT EXISTS idx_removed_tasks_ts ON removed_tasks (removed_ts);
