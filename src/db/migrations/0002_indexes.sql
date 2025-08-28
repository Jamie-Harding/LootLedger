CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions(source);
CREATE INDEX IF NOT EXISTS idx_transactions_related_task ON transactions(related_task_id);

CREATE INDEX IF NOT EXISTS idx_rules_priority ON rules(priority);
CREATE INDEX IF NOT EXISTS idx_overrides_task ON overrides(ticktick_task_id);
CREATE INDEX IF NOT EXISTS idx_penalty_prefs_task ON penalty_prefs(task_id);
CREATE INDEX IF NOT EXISTS idx_penalty_prefs_tag ON penalty_prefs(tag);
CREATE INDEX IF NOT EXISTS idx_early_bonus_prefs_task ON early_bonus_prefs(task_id);
CREATE INDEX IF NOT EXISTS idx_early_bonus_prefs_tag ON early_bonus_prefs(tag);
