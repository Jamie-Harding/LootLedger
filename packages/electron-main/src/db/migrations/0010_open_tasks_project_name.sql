ALTER TABLE open_tasks ADD COLUMN project_name TEXT;

-- optional index for filtering
CREATE INDEX IF NOT EXISTS idx_open_project_name ON open_tasks (project_name);
