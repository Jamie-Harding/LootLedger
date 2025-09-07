// packages/electron-main/src/db/queries.ts
import { randomUUID } from 'node:crypto'
import { openDb } from './index'
// For return typing only; use inline import type in signature per request
import type { Rule as EvaluatorRule } from '../rewards/evaluator'

const db = openDb()

/* ---------------- Balances / test insert ---------------- */

export function getBalance(): number {
  const row = db
    .prepare<[], { balance: number }>(
      `SELECT COALESCE(SUM(amount), 0) AS balance
         FROM transactions
        WHERE voided = 0`,
    )
    .get()
  return row?.balance ?? 0
}

export function insertTestTransaction(amount = 1): string {
  const id = randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO transactions
       (id, created_at, amount, source, reason, metadata, voided)
     VALUES
       (@id, @created_at, @amount, 'manual', 'M1 test', '{"origin":"M1"}', 0)`,
  ).run({ id, created_at: now, amount })
  return id
}

export function insertTransaction(payload: {
  id: string
  created_at: number
  amount: number
  source: string
  reason: string
  metadata: string
  related_task_id?: string
  voided?: 0 | 1
}): void {
  db.prepare(
    `INSERT INTO transactions
       (id, created_at, amount, source, reason, metadata, related_task_id, voided)
     VALUES
       (@id, @created_at, @amount, @source, @reason, @metadata, @related_task_id, @voided)`,
  ).run({
    id: payload.id,
    created_at: payload.created_at,
    amount: payload.amount,
    source: payload.source,
    reason: payload.reason,
    metadata: payload.metadata,
    related_task_id: payload.related_task_id ?? null,
    voided: payload.voided ?? 0,
  })
}

/* ---------------- app_state helpers (M2) ---------------- */

export function getState(key: string): string | null {
  const row = db
    .prepare<
      [string],
      { value: string }
    >(`SELECT value FROM app_state WHERE key = ?`)
    .get(key)
  return row ? row.value : null
}

export function setState(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, strftime('%s','now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = strftime('%s','now')`,
  ).run(key, value)
}

/* ---------------- Rules & Tag Priority (M4) ---------------- */

export type RuleType = 'exclusive' | 'additive' | 'multiplier'
export type RuleScope =
  | 'tag'
  | 'list'
  | 'title_regex'
  | 'project'
  | 'weekday'
  | 'time_range'
  | 'deadline'

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

// Internal shape matching the SELECT below (not exported)
type _Row = {
  id: number
  priority: number
  type: RuleType
  scope: RuleScope
  matchValue: string
  amount: number
  enabled: 0 | 1
  createdAt: number
  updatedAt: number
}

// Map a DB row into evaluator Rule shape (narrow/no any)
function _rowToEvaluatorRule(r: _Row): EvaluatorRule | null {
  if (r.enabled !== 1) return null

  let scope:
    | { kind: 'tag'; value: string }
    | { kind: 'list'; value: string }
    | { kind: 'project'; value: string }
    | { kind: 'title_regex'; value: string }
    | { kind: 'weekday'; value: number }
    | { kind: 'time_range'; value: { start: string; end: string } }
    | { kind: 'deadline'; value: import('../rewards/types').DeadlineValue } // NEW

  switch (r.scope) {
    case 'tag':
      scope = { kind: 'tag', value: r.matchValue }
      break
    case 'list':
      scope = { kind: 'list', value: r.matchValue }
      break
    case 'project':
      scope = { kind: 'project', value: r.matchValue }
      break
    case 'title_regex':
      scope = { kind: 'title_regex', value: r.matchValue }
      break
    case 'weekday': {
      const n = Number.parseInt(r.matchValue, 10)
      if (!Number.isFinite(n) || n < 0 || n > 6) return null
      scope = { kind: 'weekday', value: n }
      break
    }
    case 'time_range': {
      try {
        const obj = JSON.parse(r.matchValue) as unknown
        if (
          obj &&
          typeof obj === 'object' &&
          typeof (obj as { start?: unknown }).start === 'string' &&
          typeof (obj as { end?: unknown }).end === 'string'
        ) {
          scope = {
            kind: 'time_range',
            value: {
              start: (obj as { start: string }).start,
              end: (obj as { end: string }).end,
            },
          }
        } else {
          return null
        }
      } catch {
        return null
      }
      break
    }
    case 'deadline': {
      // NEW
      // Accept plain strings: 'has_deadline' | 'overdue'
      // Or JSON: { "withinHours": number }
      const mv = r.matchValue.trim()
      if (mv === 'has_deadline' || mv === 'overdue') {
        scope = { kind: 'deadline', value: mv }
        break
      }
      try {
        const obj = JSON.parse(mv) as unknown
        if (
          obj &&
          typeof obj === 'object' &&
          typeof (obj as { withinHours?: unknown }).withinHours === 'number' &&
          Number.isFinite((obj as { withinHours: number }).withinHours)
        ) {
          scope = {
            kind: 'deadline',
            value: {
              withinHours: (obj as { withinHours: number }).withinHours,
            },
          }
        } else {
          return null
        }
      } catch {
        return null
      }
      break
    }
    default:
      return null
  }

  return {
    id: String(r.id),
    enabled: true,
    mode: r.type,
    scope,
    amount: r.amount,
  }
}

// Return evaluator-shaped rules, filtered to enabled and ordered by DB priority
export function listRules(): import('../rewards/evaluator').Rule[] {
  const rows = db
    .prepare<[], _Row>(
      `SELECT id,
              priority,
              type,
              scope,
              match_value  AS matchValue,
              amount,
              enabled,
              created_at   AS createdAt,
              updated_at   AS updatedAt
         FROM rules
        ORDER BY priority ASC, id ASC`,
    )
    .all()

  const out: EvaluatorRule[] = []
  for (const r of rows) {
    const mapped = _rowToEvaluatorRule(r)
    if (mapped) out.push(mapped)
  }
  return out
}

export function upsertRule(input: UpsertRuleInput): number {
  const now = Date.now()

  if (input.id && Number.isFinite(input.id)) {
    db.prepare(
      `UPDATE rules SET
         priority    = ?,
         type        = ?,
         scope       = ?,
         match_value = ?,
         amount      = ?,
         enabled     = ?,
         updated_at  = ?
       WHERE id = ?`,
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

  if (input.scope === 'time_range') {
    // Expect matchValue to be JSON {"start":"HH:MM","end":"HH:MM"}
    try {
      const o = JSON.parse(input.matchValue) as { start?: string; end?: string }
      const isHHMM = (s?: string) => !!s && /^\d{2}:\d{2}$/.test(s)
      if (!isHHMM(o.start) || !isHHMM(o.end)) {
        throw new Error('Invalid time_range HH:MM')
      }
    } catch {
      throw new Error(
        'time_range.matchValue must be JSON with {"start":"HH:MM","end":"HH:MM"}',
      )
    }
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
  db.prepare(`DELETE FROM rules WHERE id = ?`).run(id)
}

export function reorderRules(idsInOrder: number[]): void {
  const transaction = db.transaction((ids: number[]) => {
    for (let i = 0; i < ids.length; i++) {
      db.prepare(`UPDATE rules SET priority = ? WHERE id = ?`).run(i, ids[i])
    }
  })
  transaction(idsInOrder)
}

/* ---------------- Settings (KV: name/json) ---------------- */

export function getTagPriority(): string[] {
  const row = db
    .prepare<
      [],
      { json: string }
    >(`SELECT json FROM settings WHERE name = 'tag_priority'`)
    .get()
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
    `INSERT INTO settings (name, json)
      VALUES ('tag_priority', ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json`,
  ).run(json)
}

/* ---------------- Mirror Tables (M3) ---------------- */

export function upsertCompletedTask(item: {
  task_id: string
  title: string
  tags_json: string
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  completed_ts: number
  is_recurring?: 0 | 1
  series_key?: string | null
  verified?: 0 | 1
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO completed_tasks
       (task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key, verified, revoked, revoked_ts)
     VALUES
       (@task_id, @title, @tags_json, @project_id, @list, @due_ts, @completed_ts, @is_recurring, @series_key, COALESCE(@verified, 1), 0, NULL)`,
  ).run({
    task_id: item.task_id,
    title: item.title,
    tags_json: item.tags_json,
    project_id: item.project_id ?? null,
    list: item.list ?? null,
    due_ts: item.due_ts ?? null,
    completed_ts: item.completed_ts,
    is_recurring: item.is_recurring ?? 0,
    series_key: item.series_key ?? null,
    verified: item.verified ?? 1,
  })
}

export function listRecentCompletions(limit: number): Array<{
  task_id: string
  title: string
  tags: string[]
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  completed_ts: number
  is_recurring?: boolean
  series_key?: string | null
}> {
  const rows = db
    .prepare<
      [number],
      {
        task_id: string
        title: string
        tags_json: string
        project_id: string | null
        list: string | null
        due_ts: number | null
        completed_ts: number
        is_recurring: number
        series_key: string | null
      }
    >(
      `SELECT task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key
       FROM completed_tasks
       WHERE revoked = 0
       ORDER BY completed_ts DESC
       LIMIT ?`,
    )
    .all(limit)

  return rows.map((row) => ({
    task_id: row.task_id,
    title: row.title,
    tags: (() => {
      try {
        const parsed = JSON.parse(row.tags_json)
        return Array.isArray(parsed)
          ? parsed.filter((t) => typeof t === 'string')
          : []
      } catch {
        return []
      }
    })(),
    project_id: row.project_id,
    list: row.list,
    due_ts: row.due_ts,
    completed_ts: row.completed_ts,
    is_recurring: Boolean(row.is_recurring),
    series_key: row.series_key,
  }))
}

export function upsertOpenTask(item: {
  task_id: string
  title: string
  tags_json: string
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  created_ts?: number | null
}): void {
  db.prepare(
    `INSERT OR REPLACE INTO open_tasks
       (task_id, title, tags_json, project_id, list, due_ts, created_ts)
     VALUES
       (@task_id, @title, @tags_json, @project_id, @list, @due_ts, @created_ts)`,
  ).run({
    task_id: item.task_id,
    title: item.title,
    tags_json: item.tags_json,
    project_id: item.project_id ?? null,
    list: item.list ?? null,
    due_ts: item.due_ts ?? null,
    created_ts: item.created_ts ?? null,
  })
}

export function listOpenTasks(): Array<{
  task_id: string
  title: string
  tags: string[]
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  created_ts?: number | null
}> {
  const rows = db
    .prepare<
      [],
      {
        task_id: string
        title: string
        tags_json: string
        project_id: string | null
        list: string | null
        due_ts: number | null
        created_ts: number | null
      }
    >(
      `SELECT task_id, title, tags_json, project_id, list, due_ts, created_ts
       FROM open_tasks`,
    )
    .all()

  return rows.map((row) => ({
    task_id: row.task_id,
    title: row.title,
    tags: (() => {
      try {
        const parsed = JSON.parse(row.tags_json)
        return Array.isArray(parsed)
          ? parsed.filter((t) => typeof t === 'string')
          : []
      } catch {
        return []
      }
    })(),
    project_id: row.project_id,
    list: row.list,
    due_ts: row.due_ts,
    created_ts: row.created_ts,
  }))
}

export function clearMissingOpenTasks(keptIds: string[]): void {
  if (keptIds.length === 0) {
    // If no IDs to keep, clear all open tasks
    db.prepare(`DELETE FROM open_tasks`).run()
    return
  }

  // Create placeholders for the IN clause
  const placeholders = keptIds.map(() => '?').join(',')
  db.prepare(
    `DELETE FROM open_tasks WHERE task_id NOT IN (${placeholders})`,
  ).run(...keptIds)
}

export function revokeCompletion(task_id: string, revoked_ts: number): void {
  db.prepare(
    `UPDATE completed_tasks
     SET revoked = 1, revoked_ts = @revoked_ts
     WHERE task_id = @task_id AND revoked = 0`,
  ).run({ task_id, revoked_ts })
}

export function hasActiveCompletion(task_id: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM completed_tasks WHERE task_id = @task_id AND revoked = 0 LIMIT 1`,
    )
    .get({ task_id }) as { ok?: number } | undefined
  return Boolean(row && row.ok === 1)
}

/* ---------------- Mirror Query Helpers (Structured) ---------------- */

import type Database from 'better-sqlite3'

/** Row shape used to upsert into completed_tasks. */
export type CompletedUpsert = {
  task_id: string
  title: string
  tags_json: string
  project_id: string | null
  list: string | null
  due_ts: number | null
  completed_ts: number
  is_recurring: number // 0/1
  series_key: string | null
  verified?: number // 0/1; default 1
}

/** Row shape used to upsert into open_tasks. */
export type OpenUpsert = {
  task_id: string
  title: string
  tags_json: string
  project_id: string | null
  project_name: string | null // ← NEW
  list: string | null
  due_ts: number | null
  created_ts: number | null
  etag: string | null
  sort_order: number | null
  updated_ts: number | null
  last_seen_ts: number // set to Date.now() on upsert
}

/** Read shape for recent completions (for IPC DTO assembly). */
export type RecentCompletionRow = {
  task_id: string
  title: string
  tags_json: string
  project_id: string | null
  list: string | null
  due_ts: number | null
  completed_ts: number
  is_recurring: number
  series_key: string | null
}

/** Row shape used to upsert into removed_tasks. */
export type RemovedUpsert = {
  task_id: string
  title: string
  tags_json: string
  project_id: string | null
  list: string | null
  due_ts: number | null
  removed_ts: number
  reason: 'deleted_or_moved' | 'unknown'
}

/** Read shape for previous open tasks (for comparison). */
export type PrevOpenRow = {
  task_id: string
  title: string
  tags_json: string
  project_id: string | null
  project_name: string | null // ← NEW
  list: string | null
  due_ts: number | null
  created_ts: number | null
  etag: string | null
  sort_order: number | null
  updated_ts: number | null
  last_seen_ts: number | null
}

/**
 * Mirror query helpers. Call once (with the shared DB) and reuse.
 * These do NOT modify your transactions/evaluator; they only maintain mirror tables.
 */
export function makeMirrorQueries(db: Database.Database) {
  const upsertCompleted = db.prepare(`
    INSERT OR IGNORE INTO completed_tasks
      (task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key, verified, revoked, revoked_ts)
    VALUES
      (@task_id, @title, @tags_json, @project_id, @list, @due_ts, @completed_ts, @is_recurring, @series_key, COALESCE(@verified, 1), 0, NULL)
  `)

  const upsertOpen = db.prepare(`
    INSERT INTO open_tasks
      (task_id, title, tags_json, project_id, project_name, list, due_ts, created_ts, etag, sort_order, updated_ts, last_seen_ts)
    VALUES
      (@task_id, @title, @tags_json, @project_id, @project_name, @list, @due_ts, @created_ts, @etag, @sort_order, @updated_ts, @last_seen_ts)
    ON CONFLICT(task_id) DO UPDATE SET
      title=excluded.title,
      tags_json=excluded.tags_json,
      project_id=excluded.project_id,
      project_name=excluded.project_name,
      list=excluded.list,
      due_ts=excluded.due_ts,
      created_ts=excluded.created_ts,
      etag=excluded.etag,
      sort_order=excluded.sort_order,
      updated_ts=excluded.updated_ts,
      last_seen_ts=excluded.last_seen_ts
  `)

  const readPrev = db.prepare(`
    SELECT task_id, title, tags_json, project_id, project_name, list, due_ts, created_ts, etag, sort_order, updated_ts, last_seen_ts
    FROM open_tasks
  `)

  const pruneMissing = db.prepare(`
    DELETE FROM open_tasks
    WHERE task_id NOT IN (SELECT value FROM json_each(@ids_json))
  `)

  const countOpen = db.prepare(`SELECT COUNT(*) AS n FROM open_tasks`)

  // Only list active (non-revoked) completions, newest first
  const listRecent = db.prepare(`
    SELECT task_id, title, tags_json, project_id, list, due_ts, completed_ts, is_recurring, series_key
    FROM completed_tasks
    WHERE revoked = 0
    ORDER BY completed_ts DESC
    LIMIT @limit
  `)

  // Revoke the active completion for a given task_id (if any)
  const revokeOne = db.prepare(`
    UPDATE completed_tasks
    SET revoked = 1, revoked_ts = @revoked_ts
    WHERE task_id = @task_id AND revoked = 0
  `)

  // Optional: query to check if a non-revoked completion exists for an id
  const hasActive = db.prepare(`
    SELECT 1 AS ok FROM completed_tasks WHERE task_id = @task_id AND revoked = 0 LIMIT 1
  `)

  const insertRemoved = db.prepare(`
    INSERT OR IGNORE INTO removed_tasks
      (task_id, title, tags_json, project_id, list, due_ts, removed_ts, reason)
    VALUES
      (@task_id, @title, @tags_json, @project_id, @list, @due_ts, @removed_ts, @reason)
  `)

  return {
    upsertCompletedTask(row: CompletedUpsert): void {
      upsertCompleted.run(row)
    },
    upsertOpenTask(row: OpenUpsert): void {
      upsertOpen.run(row)
    },
    readPreviousOpen(): PrevOpenRow[] {
      return readPrev.all() as PrevOpenRow[]
    },
    pruneOpenExcept(ids: string[]): void {
      pruneMissing.run({ ids_json: JSON.stringify(ids) })
    },
    countOpenTasks(): number {
      return Number((countOpen.get() as { n: number }).n)
    },
    listRecentCompletions(limit: number): RecentCompletionRow[] {
      return listRecent.all({ limit }) as RecentCompletionRow[]
    },
    revokeCompletion(task_id: string, revoked_ts: number): void {
      revokeOne.run({ task_id, revoked_ts })
    },
    hasActiveCompletion(task_id: string): boolean {
      const row = hasActive.get({ task_id }) as { ok?: number } | undefined
      return Boolean(row && row.ok === 1)
    },
    insertRemovedTask(row: RemovedUpsert): void {
      insertRemoved.run(row)
    },
  }
}
