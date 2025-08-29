import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { openDb } from './db'
import { runMigrations } from './db/migrate'
import { registerDbIpc } from './ipc'
import { registerAuthIpc } from './auth/ipc' // <-- add (if you put IPC there)
import { registerSyncIpc } from './sync/ipc' // <-- add (if you put IPC there)
import { startScheduler } from './sync' // <-- add

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
  try {
    openDb()
    runMigrations()
    registerDbIpc()

    // ⬇️ M2 wiring: no db arg anymore
    registerAuthIpc()
    registerSyncIpc()
    startScheduler()
  } catch (e) {
    console.error('[db boot] failed:', e)
  }

  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
