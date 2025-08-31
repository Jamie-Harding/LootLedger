import { openDb } from './index'
import { randomUUID } from 'node:crypto'
const db = openDb()

export function getBalance(): number {
  const db = openDb()
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(amount), 0) AS balance
      FROM transactions
      WHERE voided = 0
    `,
    )
    .get() as { balance: number }
  return row.balance ?? 0
}

export function insertTestTransaction(amount = 1): string {
  const db = openDb()
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `
      INSERT INTO transactions (id, created_at, amount, source, reason, metadata, voided)
      VALUES (@id, @created_at, @amount, 'manual', 'M1 test', '{"origin":"M1"}', 0)
    `,
  ).run({ id, created_at: now, amount })
  return id
}

// --- NEW for M2: app_state helpers ---
export function getState(key: string): string | null {
  const db = openDb()
  const row = db
    .prepare(
      `
      SELECT value
      FROM app_state
      WHERE key = ?
    `,
    )
    .get(key) as { value: string } | undefined
  return row ? row.value : null
}

export function setState(key: string, value: string): void {
  const db = openDb()
  db.prepare(
    `
      INSERT INTO app_state (key, value, updated_at)
      VALUES (?, ?, strftime('%s','now'))
      ON CONFLICT(key)
      DO UPDATE SET value = excluded.value,
                    updated_at = strftime('%s','now')
    `,
  ).run(key, value)
}

// ---- M4: Rules & Tag Priority helpers --------------------
export type RuleType = 'exclusive' | 'additive' | 'multiplier'
export type RuleScope =
  | 'tag'
  | 'list'
  | 'title_regex'
  | 'project'
  | 'weekday'
  | 'time_range'

export type RuleRow = {
  id: number
  priority: number
  type: RuleType
  scope: RuleScope
  matchValue: string
  amount: number // points for exclusive/additive; factor for multiplier
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type UpsertRuleInput = {
  id?: number
  priority: number
  type: RuleType
  scope: RuleScope
  matchValue: string
  amount: number // points for exclusive/additive; factor for multiplier
  enabled: boolean
}

export function listRules(): RuleRow[] {
  const stmt = db.prepare(
    `SELECT id, priority, type, scope,
            match_value AS matchValue, amount,
            enabled, created_at AS createdAt, updated_at AS updatedAt
     FROM rules
     ORDER BY priority ASC, id ASC`,
  )
  const rows = stmt.all() as Array<{
    id: number
    priority: number
    type: RuleType
    scope: RuleScope
    matchValue: string
    amount: number
    enabled: number
    createdAt: number
    updatedAt: number
  }>
  return rows.map((r) => ({ ...r, enabled: r.enabled === 1 }))
}

export function upsertRule(input: UpsertRuleInput): number {
  const now = Date.now()
  if (input.id && Number.isFinite(input.id)) {
    db.prepare(
      `UPDATE rules SET
         priority=?, type=?, scope=?, match_value=?,
         amount=?, enabled=?, updated_at=?
       WHERE id=?`,
    ).run(
      input.priority,
      input.type,
      input.scope,
      input.matchValue,
      input.amount,
      input.enabled ? 1 : 0,
      now,
      input.id,
    )
    return input.id
  }
  const info = db
    .prepare(
      `INSERT INTO rules
       (priority, type, scope, match_value, amount, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.priority,
      input.type,
      input.scope,
      input.matchValue,
      input.amount,
      input.enabled ? 1 : 0,
      now,
      now,
    )
  return Number(info.lastInsertRowid)
}

export function deleteRule(id: number): void {
  db.prepare(`DELETE FROM rules WHERE id=?`).run(id)
}

export function getTagPriority(): string[] {
  const row = db
    .prepare(`SELECT json FROM settings WHERE key='tag_priority'`)
    .get() as { json: string } | undefined
  if (!row) return []
  try {
    const arr = JSON.parse(row.json)
    return Array.isArray(arr) ? arr.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function setTagPriority(tags: string[]): void {
  const json = JSON.stringify(tags)
  db.prepare(
    `INSERT INTO settings (key, json) VALUES ('tag_priority', ?)
     ON CONFLICT(key) DO UPDATE SET json=excluded.json`,
  ).run(json)
}
