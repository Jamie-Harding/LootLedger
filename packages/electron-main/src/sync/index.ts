// packages/electron-main/src/sync/index.ts
import { getValidAccessToken } from '../auth'
import { TickTickClient } from './ticktickClient'
import { toTransactions } from './rules'
import { getState, setState, insertTransaction } from '../db/queries'
import { nextBackoff } from './state'
import { EventEmitter } from 'events'

export const syncEvents = new EventEmitter()

let timer: NodeJS.Timeout | null = null
let inFlight = false

export async function runOnce() {
  if (inFlight) return { ok: true, skipped: true as const }
  inFlight = true
  try {
    const enabled = (getState('sync_enabled') ?? '1') !== '0'
    if (!enabled) return { ok: true, skipped: true as const }

    const token = await getValidAccessToken()
    if (!token) return { ok: false, reason: 'no_auth' as const }

    const since = parseInt(getState('last_sync_at') ?? '0', 10)
    const client = new TickTickClient(token)

    const changes = await client.listChanges(since)
    const txs = toTransactions(changes)

    for (const tx of txs) {
      insertTransaction(tx.amount, tx.note, tx.ts, 'task', { origin: 'sync' })
    }

    const now = Date.now()
    setState('last_sync_at', String(now))
    setState('sync_backoff_ms', '0')
    syncEvents.emit('status', { ok: true, at: now, added: txs.length })
    return { ok: true as const, added: txs.length }
  } catch (e) {
    const prev = parseInt(getState('sync_backoff_ms') ?? '0', 10)
    const next = nextBackoff(prev)
    setState('sync_backoff_ms', String(next))
    syncEvents.emit('status', { ok: false, error: String(e) })
    return { ok: false as const, error: String(e) }
  } finally {
    inFlight = false
  }
}

export function startScheduler() {
  if (timer) return
  const tick = async () => {
    const res = await runOnce()
    const backoff = parseInt(getState('sync_backoff_ms') ?? '0', 10)
    const base = res.ok ? 5 * 60_000 : backoff // 5 min normal
    timer = setTimeout(tick, base || 60_000) // at least 1m on first run
  }
  tick()
}

export function stopScheduler() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
