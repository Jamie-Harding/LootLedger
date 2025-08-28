import { app, BrowserWindow } from 'electron'
import path from 'node:path'

import { openDb } from './db'
import { runMigrations } from './db/migrate'
import { registerDbIpc } from './ipc'

let win: BrowserWindow | null = null

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js') // built file in dist/

  win = new BrowserWindow({
    width: 1100,
    height: 740,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // In dev we point Electron at the Vite server
  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  await win.loadURL(devUrl)

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  // DB boot first
  openDb()
  runMigrations()

  // Wire IPC after DB is ready
  registerDbIpc()

  // Create the window
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On Windows & Linux, quit when all windows are closed
  if (process.platform !== 'darwin') app.quit()
})
