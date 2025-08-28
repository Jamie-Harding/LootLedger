-- Core “users” (TickTick identity + tokens, last_sync_at)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                   -- uuid
  ticktick_id TEXT UNIQUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at INTEGER,              -- epoch ms
  last_sync_at INTEGER,                  -- epoch ms
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Every points change
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,                   -- uuid
  created_at INTEGER NOT NULL,
  amount INTEGER NOT NULL,               -- points (can be negative)
  source TEXT NOT NULL CHECK (source IN ('task','penalty','challenge','reward','manual','undo')),
  reason TEXT,                           -- human text
  metadata TEXT,                         -- JSON string
  related_task_id TEXT,                  -- TickTick task id if relevant
  challenge_id TEXT,
  reward_id TEXT,
  undo_of_transaction_id TEXT,           -- links to original when undo
  voided INTEGER NOT NULL DEFAULT 0
);

-- Rules (exclusive/additive/multiplier) + priority
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('exclusive','additive','multiplier')),
  scope TEXT NOT NULL,                   -- JSON: {tags:[], list:..., titleRegex:..., weekday:..., timeRange:..., deadline:...}
  amount INTEGER,                        -- for exclusive/additive
  multiplier REAL,                       -- for multiplier
  priority INTEGER NOT NULL,             -- smaller = higher priority
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Overrides (one-time / series / all)
CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  ticktick_task_id TEXT,
  series_key TEXT,
  applies TEXT NOT NULL CHECK (applies IN ('one-time','series','all')),
  amount INTEGER NOT NULL,               -- sets base
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Rewards catalog
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  price INTEGER NOT NULL,
  cooldown_days INTEGER,
  weekly_limit INTEGER,                  -- NULL = unlimited
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Challenges definition
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  recipe TEXT NOT NULL,                  -- JSON logic tree
  window TEXT NOT NULL CHECK (window IN ('daily','weekly','custom')),
  award_points INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Per-window progress (award once per window)
CREATE TABLE IF NOT EXISTS challenge_progress (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,         -- epoch ms
  window_end INTEGER NOT NULL,           -- epoch ms
  counters TEXT NOT NULL,                -- JSON with counts
  awarded INTEGER NOT NULL DEFAULT 0,
  UNIQUE (challenge_id, window_start)
);

-- Streaks per challenge
CREATE TABLE IF NOT EXISTS streaks (
  id TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL UNIQUE,
  current_count INTEGER NOT NULL DEFAULT 0,
  best_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Penalty preferences (late completion)
CREATE TABLE IF NOT EXISTS penalty_prefs (
  id TEXT PRIMARY KEY,
  task_id TEXT,                          -- applies to a specific TickTick task
  tag TEXT,                              -- or a tag
  mode TEXT NOT NULL CHECK (mode IN ('one-time','daily')),
  grace_minutes INTEGER NOT NULL DEFAULT 0,
  daily_cap INTEGER,                     -- NULL = uncapped
  priority INTEGER NOT NULL DEFAULT 100, -- resolve conflicts
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Early completion bonus preferences
CREATE TABLE IF NOT EXISTS early_bonus_prefs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  tag TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('linear','tiered')),
  per_day_points INTEGER,                -- for linear
  thresholds TEXT,                       -- JSON [{days:3,bonus:5}, ...] for tiered
  cap INTEGER,                           -- max bonus per task, NULL = uncapped
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- App settings (single row)
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  tag_priority TEXT,                     -- JSON array
  time_zone TEXT,
  app_version TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
