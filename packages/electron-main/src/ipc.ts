// ipc.ts
import { ipcMain, BrowserWindow } from 'electron'
import { getBalance, insertTestTransaction, getState } from './db/queries'
import { startAuthFlow, authStatus, logout } from './auth'
import { runOnce, syncEvents } from './sync' // ⬅ import syncEvents

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

  // NEW: push sync status to all windows
  syncEvents.on('status', (payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('sync:status', payload)
    }
  })
}
