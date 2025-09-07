// packages/electron-main/src/ipc.ts
import { ipcMain, IpcMainInvokeEvent } from 'electron'
import * as Queries from './db/queries'
import * as Auth from './auth'
import { runOnce, getStatus, getRecentBuffer } from './sync'
import { registerRulesIpc } from './ipc/rules'

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
  ipcMain.handle(
    'completions:recent',
    (_e: IpcMainInvokeEvent, limit: number) => {
      return Queries.listRecentCompletions(limit)
    },
  )

  ipcMain.handle('open:list', () => {
    return Queries.listOpenTasks()
  })

  // Also register the Rules CRUD  Tester IPC here so main.ts doesn’t need to change
  registerRulesIpc()
}

// (No getLastSummary import here — remove any stray imports/handlers
// that mention it to avoid TS2305/TS1128 errors.)
