-- Add project_name column to open_tasks
-- This will fail if the column already exists, but that's OK with the new migration system
ALTER TABLE open_tasks ADD COLUMN project_name TEXT;

-- Create index (this is idempotent)
CREATE INDEX IF NOT EXISTS idx_open_project_name ON open_tasks (project_name);
