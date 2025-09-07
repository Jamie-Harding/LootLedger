// packages/electron-main/src/ipc.ts
import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as Queries from './db/queries'
import * as Auth from './auth'
import { runOnce, getStatus, getRecentBuffer } from './sync'
import { registerRulesIpc } from './ipc/rules'

type CompletionRowDTO = {
  task_id: string
  title: string
  tags: string[]
  project_id: string | null
  list: string | null
  due_ts: number | null
  completed_ts: number
  is_recurring: boolean
  series_key: string | null
}

type OpenRowDTO = {
  task_id: string
  title: string
  tags: string[]
  project_id: string | null
  list: string | null
  due_ts: number | null
  created_ts: number | null
}

// Simple type guard
function isFn(x: unknown): x is (...args: unknown[]) => unknown {
  return typeof x === 'function'
}

/* ---------------- DB IPC ---------------- */
export function registerDbIpc(): void {
  // Resolve getBalance()
  const getBalanceFn = (Queries as { getBalance?: () => unknown }).getBalance

  // Resolve insertTest or insertTestTransaction
  const insertTestFn =
    (Queries as { insertTest?: (amount?: number) => unknown }).insertTest ??
    (Queries as { insertTestTransaction?: (amount?: number) => unknown })
      .insertTestTransaction

  ipcMain.handle('db:getBalance', () => {
    if (!isFn(getBalanceFn)) {
      throw new Error('db:getBalance not implemented in db/queries')
    }
    return getBalanceFn()
  })

  ipcMain.handle('db:insertTest', (_e: IpcMainInvokeEvent, amount?: number) => {
    if (!isFn(insertTestFn)) {
      throw new Error('db:insertTest not implemented in db/queries')
    }
    return insertTestFn(typeof amount === 'number' ? amount : 1)
  })
}

/* ---------------- AUTH IPC ---------------- */
export function registerAuthIpc(): void {
  // Accept startAuthFlow() or start()
  const startFn =
    (Auth as { startAuthFlow?: () => unknown }).startAuthFlow ??
    (Auth as { start?: () => unknown }).start

  // Accept authStatus() or status()
  const statusFn =
    (Auth as { authStatus?: () => unknown }).authStatus ??
    (Auth as { status?: () => unknown }).status

  const logoutFn = (Auth as { logout?: () => unknown }).logout

  ipcMain.handle('auth:start', () => {
    if (!isFn(startFn))
      throw new Error('auth:start not implemented in auth/index')
    return startFn()
  })

  ipcMain.handle('auth:status', () => {
    if (!isFn(statusFn))
      throw new Error('auth:status not implemented in auth/index')
    return statusFn()
  })

  ipcMain.handle('auth:logout', () => {
    if (!isFn(logoutFn))
      throw new Error('auth:logout not implemented in auth/index')
    return logoutFn()
  })
}

/* ---------------- SYNC IPC ( rules wiring) ---------------- */
export function registerSyncIpc(): void {
  // Core sync routes used by your preload & renderer
  ipcMain.handle('sync:now', async () => {
    // run a one-shot tick and return an immediate snapshot so renderer can update
    await runOnce()
    return getStatus()
  })

  ipcMain.handle('sync:getStatus', () => getStatus())
  ipcMain.handle('sync:getRecent', () => getRecentBuffer())

  // Mirror data endpoints
  ipcMain.handle('completions:recent', (_evt, args: { limit?: number }) => {
    const limit = Math.max(1, Math.min(500, Number(args?.limit ?? 20)))
    const rows = Queries.listRecentCompletions(limit)
    const result: CompletionRowDTO[] = rows.map((r) => ({
      task_id: r.task_id,
      title: r.title,
      tags: r.tags,
      project_id: r.project_id ?? null,
      list: r.list ?? null,
      due_ts: r.due_ts ?? null,
      completed_ts: r.completed_ts,
      is_recurring: r.is_recurring ?? false,
      series_key: r.series_key ?? null,
    }))
    if (process.env.SYNC_TRACE === '1') {
      console.info('[ipc] completions:recent result:', result.length, 'items')
    }
    return result
  })

  ipcMain.handle('open:list', async () => {
    const { openDb } = await import('./db/index')
    const db = openDb()
    const rows = db
      .prepare(
        `
      SELECT task_id, title, tags_json, project_id, list, due_ts, created_ts
      FROM open_tasks
      ORDER BY COALESCE(due_ts, 32503680000000) ASC, title ASC
    `,
      )
      .all() as Array<{
      task_id: string
      title: string
      tags_json: string
      project_id: string | null
      list: string | null
      due_ts: number | null
      created_ts: number | null
    }>

    const result: OpenRowDTO[] = rows.map((r) => ({
      task_id: r.task_id,
      title: r.title,
      tags: JSON.parse(r.tags_json) as string[],
      project_id: r.project_id,
      list: r.list,
      due_ts: r.due_ts,
      created_ts: r.created_ts,
    }))
    if (process.env.SYNC_TRACE === '1') {
      console.info('[ipc] open:list result:', result.length, 'items')
    }
    return result
  })

  // Debug endpoint to check table existence
  ipcMain.handle('debug:checkTables', async () => {
    try {
      const { openDb } = await import('./db/index')
      const db = openDb()
      const tables = db
        .prepare<
          [],
          { name: string }
        >("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
      console.log(
        '[debug] Available tables:',
        tables.map((t) => t.name),
      )
      return tables.map((t) => t.name)
    } catch (error) {
      console.error('[debug] Error checking tables:', error)
      throw error
    }
  })

  // Also register the Rules CRUD  Tester IPC here so main.ts doesn’t need to change
  registerRulesIpc()
}

// (No getLastSummary import here — remove any stray imports/handlers
// that mention it to avoid TS2305/TS1128 errors.)
