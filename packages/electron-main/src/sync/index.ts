// packages/electron-main/src/sync/index.ts
import { BrowserWindow } from 'electron'
import { EventEmitter } from 'events'
import * as Tick from './ticktickClient'
// Use namespace import so we can optionally call insert helpers if present
import * as Q from '../db/queries'
import {
  evaluateTask,
  type Rule as EvalRule,
  type TaskContext,
} from '../rewards/evaluator'
import { randomUUID } from 'node:crypto'

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

// Shape expected from ticktickClient
type TickTickItem = {
  id: string
  title?: string
  tags?: string[]
  projectId?: string
  due?: number | { ts?: number | null } | null
  completedTime?: number
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

function coerceDueTs(due: TickTickItem['due']): number | null {
  if (typeof due === 'number') return due
  if (isDueObj(due) && typeof due.ts === 'number') return due.ts
  return null
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
  const lastSyncRaw = Q.getState('last_sync_at')
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
  const completed = typeof it.completedTime === 'number' ? it.completedTime : 0
  const d = new Date(completed)
  const weekday = d.getDay() // 0..6 (Sun=0)
  const timeOfDayMin = d.getHours() * 60 + d.getMinutes()
  return {
    id: it.id,
    title: it.title ?? '',
    tags: Array.isArray(it.tags) ? it.tags : [],
    list: undefined, // (fill if you track lists)
    projectId: it.projectId,
    completedAt: completed,
    dueAt: coerceDueTs(it.due),
    weekday,
    timeOfDayMin,
  }
}

// ---------- Optional insert bridge (won't throw if missing) ----------
type InsertArg = {
  id: string
  created_at: number
  amount: number
  source: string
  reason: string
  metadata: string
  voided?: 0 | 1
}

const insertTx: ((arg: InsertArg) => unknown) | undefined =
  (Q as unknown as { insertTransaction?: (arg: InsertArg) => unknown })
    .insertTransaction ??
  (Q as unknown as { insertTicktickTransaction?: (arg: InsertArg) => unknown })
    .insertTicktickTransaction

// ---------- Core: one sync tick ----------
export async function runOnce(): Promise<SyncNowResult> {
  const lastSyncRaw = Q.getState('last_sync_at')
  const lastSyncMs = lastSyncRaw ? Number(lastSyncRaw) : 0
  const sinceIso = new Date(lastSyncMs || 0).toISOString()

  try {
    // 1) Pull changed/completed tasks
    const items = await listSince(sinceIso)

    // 1.5) Load rules + tag order for this tick
    // (listRules / getTagPriority exist in M4 queries; if not, default)
    const rules: EvalRule[] =
      (Q as unknown as { listRules?: () => EvalRule[] }).listRules?.() ?? []
    const tagOrder: string[] =
      (
        Q as unknown as { getTagPriority?: () => string[] }
      ).getTagPriority?.() ?? []

    // 2) Filter to truly-new completions, evaluate, and (optionally) insert tx
    let newCount = 0
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
        const ctx = toTaskContext(it)
        const breakdown = evaluateTask(ctx, rules, tagOrder)
        const points = breakdown.finalRounded

        // Optional DB insert (only if helper exists)
        if (insertTx) {
          const tx: InsertArg = {
            id: randomUUID(),
            created_at: rc.completedTs,
            amount: points,
            source: 'ticktick',
            reason: rc.title || 'TickTick completion',
            metadata: JSON.stringify({
              taskId: rc.taskId,
              tags: rc.tags,
              projectId: rc.projectId,
              dueTs: rc.dueTs,
              isRecurring: rc.isRecurring,
              seriesKey: rc.seriesKey,
              eval: breakdown,
            }),
            voided: 0,
          }
          try {
            insertTx(tx)
          } catch (e) {
            console.warn('[sync] insertTransaction failed:', e)
          }
        }
      } catch (e) {
        console.warn('[sync] evaluation failed for task', rc.taskId, e)
      }

      pushRecent(rc)
      newCount++
    }

    if (newCount > 0) broadcastRecent()

    // 3) Advance sync cursor on success
    const now = Date.now()
    Q.setState('last_sync_at', String(now))

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
