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
