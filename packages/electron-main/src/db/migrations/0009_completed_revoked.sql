-- Add revocation fields to completed_tasks
ALTER TABLE completed_tasks ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;   -- 0: active, 1: revoked
ALTER TABLE completed_tasks ADD COLUMN revoked_ts INTEGER;                   -- epoch ms when revoked

-- Optional index so "recent & active" is fast
CREATE INDEX IF NOT EXISTS idx_completed_active_ts
  ON completed_tasks (revoked ASC, completed_ts DESC);
