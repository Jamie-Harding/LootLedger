import dotenv from 'dotenv'
import path from 'node:path'

// Load .env.local from the package root (we run from dist/)
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })
// Also load .env if someone uses that filename
dotenv.config()

import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { openDb } from './db'
import { runMigrations } from './db/migrate'
import { registerDbIpc, registerAuthIpc, registerSyncIpc } from './ipc'
import { startScheduler } from './sync'
import 'dotenv/config'

let win: BrowserWindow | null = null

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  console.log(
    '[main] preload path:',
    preloadPath,
    'exists?',
    fs.existsSync(preloadPath),
  )

  win = new BrowserWindow({
    width: 1100,
    height: 740,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  await win.loadURL(devUrl)

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  // Try DB boot/migrations, but don’t block IPC if it fails
  try {
    openDb()
    runMigrations()
  } catch (e) {
    console.error('[db boot] failed:', e)
  }

  // Always register IPC + scheduler (each handler opens DB on demand)
  registerDbIpc()
  registerAuthIpc()
  registerSyncIpc()
  startScheduler()

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
