// ipc.ts
import { ipcMain } from 'electron'
import { getBalance, insertTestTransaction, getState } from './db/queries'
import { startAuthFlow, authStatus, logout } from './auth'
import { runOnce } from './sync'

// --- DB (M1) ---
export function registerDbIpc() {
  ipcMain.handle('db:getBalance', () => getBalance())
  ipcMain.handle('db:insertTest', (_e, amount: number = 1) =>
    insertTestTransaction(amount),
  )
}

// --- Auth (M2) ---
export function registerAuthIpc() {
  ipcMain.handle('auth:start', () => startAuthFlow())
  ipcMain.handle('auth:status', () => authStatus())
  ipcMain.handle('auth:logout', () => {
    logout()
    return true
  })
}

// --- Sync (M2) ---
export function registerSyncIpc() {
  ipcMain.handle('sync:now', () => runOnce())
  ipcMain.handle('sync:getStatus', () => ({
    lastSyncAt: getState('last_sync_at'),
  }))
}
