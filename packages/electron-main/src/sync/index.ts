// packages/electron-main/src/sync/index.ts
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import * as Tick from './ticktickClient'
import {
  listOpenTasks,
  listCompletedSince,
  TickTask,
  TickTickAuth,
  listOpenTasksLegacy,
} from './ticktickClient'
import { parseTickTickDate } from './ticktickDate'
import {
  listRules,
  getTagPriority,
  insertTransaction,
  getState,
  setState,
  upsertCompletedTask,
  upsertOpenTask,
  clearMissingOpenTasks,
  listOpenTasks as listOpenTasksFromDb,
  makeMirrorQueries,
} from '../db/queries'
import { openDb } from '../db/index'
import { getValidAccessToken } from '../auth'
import { evaluateTask, type Rule } from '../rewards/evaluator'
import type { TaskContext, TaskTransactionMetaV1 } from '../rewards/types'
import { randomUUID } from 'node:crypto'

const SYNC_TRACE = process.env.SYNC_TRACE === '1'
const ROLLOVER_MIN_DELTA_MS = 60_000

// ---------- Types ----------
export type RecentCompletion = {
  taskId: string
  title: string
  tags: string[]
  projectId?: string
  dueTs?: number | null // ms
  completedTs: number // ms
  isRecurring?: boolean
  seriesKey?: string | null
}

export type SyncStatus = {
  lastSyncAt: number | null // ms
  error: string | null
  polling: boolean
  pollSeconds: number
  backoffMs: number
  nextRunInMs: number
}

// TickTick shapes we actually consume during sync
type TickTickDue =
  | number // epoch ms
  | string // ISO-ish
  | { date?: string } // some APIs return { date: '...' }
  | null
  | undefined

// Shape expected from ticktickClient
type TickTickItem = {
  id: string
  title?: string
  tags?: string[]
  projectId?: string
  due?: TickTickDue
  completedTime?: number | string
  isRecurring?: boolean
  seriesKey?: string | null
}

type TickModule = {
  listCompletedTasksSince?: (sinceIso: string) => Promise<TickTickItem[]>
  listChanges?: (sinceIso: string) => Promise<TickTickItem[]>
  default?: {
    listCompletedTasksSince?: (sinceIso: string) => Promise<TickTickItem[]>
    listChanges?: (sinceIso: string) => Promise<TickTickItem[]>
  }
}

// ---------- Resolve list function without `any` ----------
async function listSince(sinceIso: string): Promise<TickTickItem[]> {
  const mod = Tick as unknown as TickModule
  if (mod.listCompletedTasksSince) return mod.listCompletedTasksSince(sinceIso)
  if (mod.listChanges) return mod.listChanges(sinceIso)
  if (mod.default?.listCompletedTasksSince)
    return mod.default.listCompletedTasksSince(sinceIso)
  if (mod.default?.listChanges) return mod.default.listChanges(sinceIso)
  throw new Error(
    'ticktickClient: missing listCompletedTasksSince/listChanges export',
  )
}

// ---------- Module state ----------
const RECENT_RING_MAX = 100
const DEFAULT_POLL_SECONDS = 180 // 3 minutes

const recentBuffer: RecentCompletion[] = []
const seen = new Set<string>() // key = `${taskId}:${completedTs}`

let currentTimer: NodeJS.Timeout | null = null
let pollSeconds = DEFAULT_POLL_SECONDS

let consecutiveFailures = 0
let lastError: string | null = null
let nextPlannedAt: number | null = null

export const syncEvents = new EventEmitter()

// ---------- Helpers ----------
function key(taskId: string, completedTs: number) {
  return `${taskId}:${completedTs}`
}

// Narrow unknown/various to a timestamp or undefined
function coerceDueTs(due: TickTickDue): number | undefined {
  if (due == null) return undefined
  if (typeof due === 'number' && Number.isFinite(due)) return due
  if (typeof due === 'string') {
    return parseTickTickDate(due) ?? undefined
  }
  if (typeof due === 'object' && typeof due.date === 'string') {
    return parseTickTickDate(due.date) ?? undefined
  }
  return undefined
}

function pushRecent(item: RecentCompletion) {
  recentBuffer.unshift(item)
  if (recentBuffer.length > RECENT_RING_MAX) recentBuffer.pop()
}

function broadcastRecent() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:recent', recentBuffer)
  }
  syncEvents.emit('recent', recentBuffer)
}

export function emitStatus() {
  const status = getStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:status', status)
  }
  syncEvents.emit('status', status)
}

function emitOneShot(payload: SyncNowResult) {
  console.log('[sync] emitOneShot - payload:', payload)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:result', payload)
  }
}

function computeBackoffMs(): number {
  const base = pollSeconds * 1000
  if (consecutiveFailures === 0) return base
  const factor = Math.min(Math.pow(2, consecutiveFailures), 5)
  return base * factor
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

// ---------- Public getters ----------
export function getRecentBuffer(): RecentCompletion[] {
  return recentBuffer
}

export function getStatus(): SyncStatus {
  const lastSyncRaw = getState('last_sync_at')
  const lastSyncAt = lastSyncRaw ? Number(lastSyncRaw) : null
  const backoff = computeBackoffMs()
  const nextIn = nextPlannedAt
    ? Math.max(0, nextPlannedAt - Date.now())
    : backoff

  return {
    lastSyncAt,
    error: lastError,
    polling: currentTimer !== null,
    pollSeconds,
    backoffMs: backoff,
    nextRunInMs: nextIn,
  }
}

// one-shot payload the renderer expects on sync completion/failure
type SyncNowResult =
  | { ok: true; at: number; added: number }
  | { ok: false; error: string }

// ---------- Core: one sync tick ----------
export async function runOnce(): Promise<SyncNowResult> {
  try {
    console.log('[sync] Starting sync...')

    const authToken = await getValidAccessToken()
    if (!authToken) {
      throw new Error('No valid access token available')
    }
    console.log('[sync] Got auth token')

    const auth: TickTickAuth = { accessToken: authToken }

    const now = Date.now()
    const rawLast = Number(getState('last_sync_at') || 0)
    const sinceMs =
      rawLast > 0 && rawLast <= now ? rawLast : now - 7 * 24 * 3600_000
    const sinceIso = new Date(sinceMs).toISOString()
    console.log('[sync] Since time:', sinceIso)

    // Initialize mirror queries
    const db = openDb()
    const Q = makeMirrorQueries(db)

    // 1) Read prev snapshot BEFORE any writes
    const prevRows = Q.readPreviousOpen()
    console.log('[sync] Previous open tasks:', prevRows.length)
    const prevById = new Map(prevRows.map((r) => [r.task_id, r]))
    const prevIds = new Set(prevRows.map((r) => r.task_id))

    // 2) Fetch ALL open tasks (using legacy function)
    console.log('[sync] Fetching current open tasks...')
    const freshLegacy = await listOpenTasksLegacy()
    console.log('[sync] Current open tasks (legacy):', freshLegacy.length)
    const currRows = freshLegacy.map((o) => {
      const due_ts = o.dueAt ?? null
      return {
        task_id: o.id,
        title: o.title,
        tags_json: JSON.stringify(o.tags ?? []),
        project_id: o.project ?? null,
        list: o.list ?? null,
        due_ts,
        created_ts: o.createdAt ?? null,
        etag: null as string | null,
        sort_order: null as number | null,
        updated_ts: null as number | null,
        last_seen_ts: now,
      }
    })
    const currIds = new Set(currRows.map((r) => r.task_id))

    // 3a) Disappearances (candidate set)
    const disappearedIds: string[] = []
    for (const id of prevIds) if (!currIds.has(id)) disappearedIds.push(id)
    console.log('[sync] Disappeared tasks:', disappearedIds.length)

    // 3b) Rollovers (same id, due advanced or etag changed with some due movement)
    type CurrRow = (typeof currRows)[number]
    const currById = new Map(currRows.map((r) => [r.task_id, r]))
    const rollovers: Array<{ prev: (typeof prevRows)[number]; curr: CurrRow }> =
      []

    for (const id of currIds) {
      const prev = prevById.get(id)
      if (!prev) continue
      const curr = currById.get(id)!
      const prevDue = prev.due_ts ?? null
      const currDue = curr.due_ts ?? null
      const dueAdvanced =
        prevDue != null &&
        currDue != null &&
        currDue - prevDue >= ROLLOVER_MIN_DELTA_MS
      const dueChangedAtAll = (prevDue ?? null) !== (currDue ?? null)
      const etagChanged = (prev.etag || null) !== (curr.etag || null)

      if (dueAdvanced || (etagChanged && dueChangedAtAll)) {
        rollovers.push({ prev, curr })
      }
    }
    console.log('[sync] Rollovers found:', rollovers.length)

    // 4) For disappearance candidates, cross-check via completions API in a minimal window.
    // Window lower bound = min(last_seen_ts among those ids) - 1 day (to be safe).
    let minLastSeen = now
    for (const id of disappearedIds) {
      const p = prevById.get(id)
      if (p?.last_seen_ts != null && p.last_seen_ts < minLastSeen)
        minLastSeen = p.last_seen_ts
    }
    const fromMs = Math.min(minLastSeen, now) - 24 * 3600_000
    const fromIso = new Date(fromMs).toISOString()

    const completedEvidenceById = new Map<string, number>() // id → completed_ts (ms)
    try {
      console.log(
        '[sync] Checking completions API from:',
        fromIso,
        'to:',
        new Date(now).toISOString(),
      )
      const completed = await listCompletedSince(
        auth,
        fromIso,
        new Date(now).toISOString(),
        800,
      )
      console.log('[sync] Completions API returned:', completed.length, 'tasks')
      for (const t of completed) {
        if (t.status !== 2) continue
        const ct = parseTickTickDate(t.completedTime ?? null)
        if (ct == null) continue
        // A given id may complete multiple times if recurring; keep the latest we saw in the window
        const prevCt = completedEvidenceById.get(t.id) ?? 0
        if (ct > prevCt) completedEvidenceById.set(t.id, ct)
      }
      console.log(
        '[sync] Found evidence for',
        completedEvidenceById.size,
        'completed tasks',
      )
    } catch (e) {
      console.error(
        '[sync] completions cross-check failed; treating disappearances cautiously:',
        (e as Error).message,
      )
    }

    // 5) Load rules + tag order for task evaluation
    const rules: Rule[] = listRules()
    const tagOrder: string[] = getTagPriority()

    // 6) Mirror: rollovers are confirmed completions; disappearances require evidence
    let mirroredCompletions = 0
    let quarantinedRemoved = 0
    let processedTransactions = 0

    // Rollovers → definitely a completion (use previous instance metadata)
    for (const x of rollovers) {
      const prev = x.prev
      const completed_ts = now // we don't have precise; next improvement can hydrate if needed

      // Mirror to completed_tasks table
      Q.upsertCompletedTask({
        task_id: prev.task_id,
        title: prev.title,
        tags_json: prev.tags_json,
        project_id: prev.project_id,
        list: prev.list,
        due_ts: prev.due_ts,
        completed_ts,
        is_recurring: 1,
        series_key: null,
      })

      // Evaluate and create transaction
      try {
        const tags = JSON.parse(prev.tags_json) as string[]
        const ctx: TaskContext = {
          id: prev.task_id,
          title: prev.title,
          tags: Array.isArray(tags) ? tags : [],
          list: prev.list,
          project: prev.project_id,
          completedAt: completed_ts,
          dueAt: prev.due_ts,
        }

        const breakdown = evaluateTask(ctx, rules, tagOrder)

        const meta: TaskTransactionMetaV1 = {
          kind: 'task_evaluated',
          version: 1,
          breakdown,
          task: {
            id: ctx.id,
            title: ctx.title,
            tags: ctx.tags,
            list: ctx.list,
            project: ctx.project,
            completedAt: ctx.completedAt,
            dueAt: ctx.dueAt,
          },
        }

        // Insert the main transaction (pre-penalty for M4)
        await insertTransaction({
          id: randomUUID(),
          created_at: completed_ts,
          amount: breakdown.pointsPrePenalty,
          source: 'task',
          reason: 'TickTick completion (rollover)',
          metadata: JSON.stringify(meta),
          related_task_id: ctx.id,
        })

        // Add to recent buffer
        const rc: RecentCompletion = {
          taskId: prev.task_id,
          title: prev.title,
          tags: ctx.tags,
          projectId: prev.project_id ?? undefined,
          dueTs: prev.due_ts,
          completedTs: completed_ts,
          isRecurring: true,
          seriesKey: null,
        }
        pushRecent(rc)
        processedTransactions++
      } catch (e) {
        console.warn(
          '[sync] evaluation failed for rollover task',
          prev.task_id,
          e,
        )
      }

      mirroredCompletions++
    }

    // Disappearances → only if completions API says so; else quarantine as removed
    for (const id of disappearedIds) {
      const prev = prevById.get(id)
      if (!prev) continue

      const evidenceTs = completedEvidenceById.get(id)
      if (typeof evidenceTs === 'number') {
        // Mirror to completed_tasks table
        Q.upsertCompletedTask({
          task_id: prev.task_id,
          title: prev.title,
          tags_json: prev.tags_json,
          project_id: prev.project_id,
          list: prev.list,
          due_ts: prev.due_ts,
          completed_ts: evidenceTs,
          is_recurring: 0,
          series_key: null,
        })

        // Evaluate and create transaction
        try {
          const tags = JSON.parse(prev.tags_json) as string[]
          const ctx: TaskContext = {
            id: prev.task_id,
            title: prev.title,
            tags: Array.isArray(tags) ? tags : [],
            list: prev.list,
            project: prev.project_id,
            completedAt: evidenceTs,
            dueAt: prev.due_ts,
          }

          const breakdown = evaluateTask(ctx, rules, tagOrder)

          const meta: TaskTransactionMetaV1 = {
            kind: 'task_evaluated',
            version: 1,
            breakdown,
            task: {
              id: ctx.id,
              title: ctx.title,
              tags: ctx.tags,
              list: ctx.list,
              project: ctx.project,
              completedAt: ctx.completedAt,
              dueAt: ctx.dueAt,
            },
          }

          // Insert the main transaction (pre-penalty for M4)
          await insertTransaction({
            id: randomUUID(),
            created_at: evidenceTs,
            amount: breakdown.pointsPrePenalty,
            source: 'task',
            reason: 'TickTick completion (disappeared)',
            metadata: JSON.stringify(meta),
            related_task_id: ctx.id,
          })

          // Add to recent buffer
          const rc: RecentCompletion = {
            taskId: prev.task_id,
            title: prev.title,
            tags: ctx.tags,
            projectId: prev.project_id ?? undefined,
            dueTs: prev.due_ts,
            completedTs: evidenceTs,
            isRecurring: false,
            seriesKey: null,
          }
          pushRecent(rc)
          processedTransactions++
        } catch (e) {
          console.warn(
            '[sync] evaluation failed for disappeared task',
            prev.task_id,
            e,
          )
        }

        mirroredCompletions++
      } else {
        Q.insertRemovedTask({
          task_id: prev.task_id,
          title: prev.title,
          tags_json: prev.tags_json,
          project_id: prev.project_id,
          list: prev.list,
          due_ts: prev.due_ts,
          removed_ts: now,
          reason: 'deleted_or_moved',
        })
        quarantinedRemoved++
      }
    }

    // 7) Replace snapshot and prune
    for (const row of currRows) Q.upsertOpenTask(row)
    Q.pruneOpenExcept(currRows.map((r) => r.task_id))

    // 8) Advance last_sync_at conservatively (+1s guard)
    const nextLast = Math.max(sinceMs, now) + 1000
    setState('last_sync_at', String(nextLast))

    console.log(
      '[sync] Final results - mirrored completions:',
      mirroredCompletions,
      'removed quarantined:',
      quarantinedRemoved,
      'transactions processed:',
      processedTransactions,
    )
    if (process.env.SYNC_TRACE === '1') {
      console.info(
        '[sync] mirrored completions:',
        mirroredCompletions,
        'removed quarantined:',
        quarantinedRemoved,
        'transactions processed:',
        processedTransactions,
        'next last_sync_at:',
        nextLast,
      )
    }

    // 9) Broadcast recent completions if any were processed
    if (processedTransactions > 0) {
      broadcastRecent()
    }

    // Reset failure state, emit status
    consecutiveFailures = 0
    lastError = null
    emitOneShot({ ok: true, at: now, added: processedTransactions })
    emitStatus()
    return { ok: true, at: now, added: processedTransactions }
  } catch (err) {
    consecutiveFailures = Math.min(consecutiveFailures + 1, 8)
    lastError = stringifyError(err)
    emitOneShot({ ok: false, error: lastError })
    emitStatus()
    return { ok: false, error: lastError }
  }
}

// ---------- Scheduler (setTimeout-based; no private fields) ----------
function scheduleNextTick(): void {
  const delay = computeBackoffMs()
  nextPlannedAt = Date.now() + delay

  if (currentTimer) clearTimeout(currentTimer)
  currentTimer = setTimeout(async () => {
    await runOnce()
    scheduleNextTick() // chain next run after each tick
  }, delay)
}

export function startScheduler(seconds?: number) {
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    pollSeconds = Math.floor(seconds)
  }
  if (currentTimer) clearTimeout(currentTimer)

  // Run immediately to warm the buffer/status, then schedule next
  runOnce().finally(() => {
    scheduleNextTick()
    emitStatus()
  })
}

export function stopScheduler() {
  if (currentTimer) clearTimeout(currentTimer)
  currentTimer = null
  nextPlannedAt = null
  emitStatus()
}

export function setPollingInterval(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return
  pollSeconds = Math.floor(seconds)
  if (currentTimer) {
    // restart timer with new interval/backoff
    scheduleNextTick()
  }
  emitStatus()
}
