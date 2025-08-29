import { openDb } from './index'
import { randomUUID } from 'node:crypto'

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
