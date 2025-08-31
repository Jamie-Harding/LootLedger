-- rules (priority + type + scope)
CREATE TABLE IF NOT EXISTS rules (
  id            INTEGER PRIMARY KEY,
  priority      INTEGER NOT NULL,                 -- lower = higher priority
  type          TEXT NOT NULL,                    -- 'exclusive' | 'additive' | 'multiplier'
  scope         TEXT NOT NULL,                    -- 'tag' | 'list' | 'title_regex' | 'project' | 'weekday' | 'time_range'
  match_value   TEXT NOT NULL,                    -- e.g. '#study' or '^read:.*'
  amount        REAL NOT NULL DEFAULT 0,          -- points for additive/exclusive; factor for multiplier
  enabled       INTEGER NOT NULL DEFAULT 1,       -- 1=true, 0=false
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- settings: tag priority array and poll interval
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  json  TEXT NOT NULL
);

-- seed defaults if empty (tag order empty list; poll 180s)
INSERT OR IGNORE INTO settings(key, json) VALUES
('tag_priority', json('[]')),
('sync_poll_seconds', json('180'));

-- seen set for completions (avoid double-processing)
CREATE TABLE IF NOT EXISTS seen_completions (
  task_id        TEXT NOT NULL,
  completed_ts   INTEGER NOT NULL,
  seen_at        INTEGER NOT NULL,
  PRIMARY KEY (task_id, completed_ts)
);
