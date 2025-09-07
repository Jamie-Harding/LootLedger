// sync/rules.ts

import { parseTickTickDate } from './ticktickDate'

// Minimal shape we need from TickTick "changes".
// Add fields as you integrate the real API.
export type TickTickChange = {
  type: 'task_completed' | string
  title?: string
  completedAt?: string | number | Date
}

export type TransactionDraft = {
  amount: number
  note: string
  ts: number // epoch ms
}

function toEpochMs(v?: string | number | Date): number {
  if (v == null) return Date.now()
  if (typeof v === 'number') return v
  if (v instanceof Date) return v.getTime()
  return parseTickTickDate(v) ?? Date.now()
}

// Map TickTick events → transaction drafts for the DB layer.
export function toTransactions(
  changes: readonly TickTickChange[],
): TransactionDraft[] {
  return changes.flatMap((ev) => {
    if (ev.type === 'task_completed') {
      const amount = 1 // TODO: replace with rule-evaluated points
      const note = `Completed: ${ev.title ?? 'Untitled task'}`
      const ts = toEpochMs(ev.completedAt)
      return [{ amount, note, ts }]
    }
    return []
  })
}
