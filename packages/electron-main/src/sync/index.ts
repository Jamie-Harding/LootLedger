// packages/electron-main/src/sync/index.ts
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import * as Tick from './ticktickClient'
import {
  listRules,
  getTagPriority,
  insertTransaction,
  getState,
  setState,
  upsertCompletedTask,
  upsertOpenTask,
  clearMissingOpenTasks,
} from '../db/queries'
import { evaluateTask, type Rule } from '../rewards/evaluator'
import type { TaskContext, TaskTransactionMetaV1 } from '../rewards/types'
import { randomUUID } from 'node:crypto'

const SYNC_TRACE = process.env.SYNC_TRACE === '1'

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
    const t = Date.parse(due)
    return Number.isNaN(t) ? undefined : t
  }
  if (typeof due === 'object' && typeof due.date === 'string') {
    const t = Date.parse(due.date)
    return Number.isNaN(t) ? undefined : t
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

function emitStatus() {
  const status = getStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:status', status)
  }
  syncEvents.emit('status', status)
}

function emitOneShot(payload: SyncNowResult) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('sync:status', payload)
  }
}

function isDueObj(v: unknown): v is { ts?: number | null } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'ts' in (v as Record<string, unknown>)
  )
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

// ---------- Build evaluator context ----------
function toTaskContext(it: TickTickItem): TaskContext {
  const completedAt =
    typeof it.completedTime === 'number'
      ? it.completedTime
      : typeof it.completedTime === 'string'
        ? Date.parse(it.completedTime)
        : Date.now()

  return {
    id: it.id,
    title: it.title ?? '',
    tags: Array.isArray(it.tags) ? it.tags : [],
    list: undefined,
    project: it.projectId ?? null,
    completedAt,
    dueAt: coerceDueTs(it.due) ?? null,
  }
}

// ---------- Core: one sync tick ----------
export async function runOnce(): Promise<SyncNowResult> {
  const lastSyncRaw = getState('last_sync_at')
  const lastSyncMs = lastSyncRaw ? Number(lastSyncRaw) : 0
  const sinceIso = new Date(lastSyncMs || 0).toISOString()

  if (SYNC_TRACE) console.info('[sync] sinceIso =', sinceIso)

  try {
    // 1) Pull changed/completed tasks
    const items = await listSince(sinceIso)

    if (SYNC_TRACE)
      console.info('[sync] fetched completed items =', items.length)

    // 1.5) Load rules + tag order for this tick
    const rules: Rule[] = listRules()
    const tagOrder: string[] = getTagPriority()

    // 2) Filter to truly-new completions, evaluate, and (optionally) insert tx
    let newCount = 0
    let processed = 0
    for (const it of items) {
      const taskId = it.id
      const completedTs =
        typeof it.completedTime === 'number' ? it.completedTime : 0
      if (!taskId || !completedTs) continue

      const k = key(taskId, completedTs)
      if (seen.has(k)) continue
      seen.add(k)

      const rc: RecentCompletion = {
        taskId,
        title: it.title ?? '',
        tags: Array.isArray(it.tags) ? it.tags : [],
        projectId: it.projectId,
        dueTs: coerceDueTs(it.due),
        completedTs,
        isRecurring: !!it.isRecurring,
        seriesKey: it.seriesKey ?? null,
      }

      // Evaluate with rules
      try {
        const ctx: TaskContext = {
          id: it.id,
          title: it.title ?? '',
          tags: Array.isArray(it.tags) ? it.tags : [],
          list: undefined,
          project: it.projectId ?? null,
          completedAt: rc.completedTs,
          dueAt: rc.dueTs ?? null,
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
          created_at: rc.completedTs,
          amount: breakdown.pointsPrePenalty,
          source: 'task',
          reason: 'TickTick completion',
          metadata: JSON.stringify(meta),
          related_task_id: ctx.id,
        })

        // Mirror completed task to completed_tasks table
        upsertCompletedTask({
          task_id: it.id,
          title: it.title ?? '',
          tags_json: JSON.stringify(it.tags ?? []),
          project_id: it.projectId ?? null,
          list: null, // list not available in TickTickItem
          due_ts: coerceDueTs(it.due) ?? null,
          completed_ts: rc.completedTs,
          is_recurring: it.isRecurring ? 1 : 0,
          series_key: it.seriesKey ?? null,
        })

        processed++
      } catch (e) {
        console.warn('[sync] evaluation failed for task', rc.taskId, e)
      }

      pushRecent(rc)
      newCount++
    }

    if (SYNC_TRACE) console.info('[sync] processed =', processed)

    if (newCount > 0) broadcastRecent()

    // Mirror open tasks
    try {
      const open = await Tick.listOpenTasks()
      for (const o of open) {
        upsertOpenTask({
          task_id: o.id,
          title: o.title,
          tags_json: JSON.stringify(o.tags ?? []),
          project_id: o.project ?? null,
          list: o.list ?? null,
          due_ts: o.dueAt ?? null,
          created_ts: o.createdAt ?? null,
        })
      }
      // Clear open tasks that are no longer present
      clearMissingOpenTasks(open.map((x) => x.id))

      if (SYNC_TRACE) {
        console.info(
          '[sync] mirrored completed:',
          processed,
          'open:',
          open.length,
        )
      }
    } catch (e) {
      console.warn('[sync] failed to mirror open tasks:', e)
    }

    // 3) Advance sync cursor on success
    const now = Date.now()
    setState('last_sync_at', String(now))

    // 4) Reset failure state, emit status
    consecutiveFailures = 0
    lastError = null
    // send both: the one-shot (renderer listens for this) and the full snapshot
    emitOneShot({ ok: true, at: now, added: newCount })
    emitStatus()
    return { ok: true, at: now, added: newCount }
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
