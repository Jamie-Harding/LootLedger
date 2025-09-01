-- 0004_rules_and_settings.sql

-- Rules table
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER PRIMARY KEY,
  priority    INTEGER NOT NULL,
  type        TEXT NOT NULL,            -- 'exclusive' | 'additive' | 'multiplier'
  scope       TEXT NOT NULL,            -- 'tag' | 'list' | 'title_regex' | 'project' | 'weekday' | 'time_range'
  match_value TEXT NOT NULL,            -- e.g., '#study' or '^read:.*'
  amount      REAL NOT NULL DEFAULT 0,  -- points for exclusive/additive; factor for multiplier
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Seen set to avoid double-processing the same completion
CREATE TABLE IF NOT EXISTS seen_completions (
  task_id       TEXT NOT NULL,
  completed_ts  INTEGER NOT NULL,
  seen_at       INTEGER NOT NULL,
  PRIMARY KEY (task_id, completed_ts)
);

-- NOTE: Do NOT touch the 'settings' table here. Normalization + seeding is done in 0005.
