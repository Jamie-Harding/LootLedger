-- 0005_open_tasks.sql
-- Create a mirror table for open tasks

CREATE TABLE IF NOT EXISTS open_tasks (
  task_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  project_id TEXT,
  list TEXT,
  due_ts INTEGER,
  created_ts INTEGER
);
