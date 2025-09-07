// packages/electron-main/src/main.ts
import path from 'node:path'
import fs from 'node:fs'
import { app, BrowserWindow } from 'electron'

// Load .env.local from the package root (we run from dist/)
import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })
dotenv.config() // also load .env if present
import 'dotenv/config'

import { openDb } from './db'
import { runMigrations } from './db/migrate'
import { registerDbIpc, registerAuthIpc, registerSyncIpc } from './ipc'
import { startScheduler } from './sync'

// ---- Hard crash traps so failures are visible in console ----
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandledRejection:', reason)
})

// Optional: fewer GPU quirks on Windows blank screens
if (process.platform === 'win32') {
  app.disableHardwareAcceleration()
}

let win: BrowserWindow | null = null

async function createWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, 'preload.js')
  console.log(
    '[main] creating window, preload:',
    preloadPath,
    'exists?',
    fs.existsSync(preloadPath),
  )

  const w = new BrowserWindow({
    width: 1100,
    height: 740,
    show: false, // show when ready for smoother UX
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  })

  w.once('ready-to-show', () => {
    console.log('[main] ready-to-show — showing window')
    w.show()
  })

  w.webContents.on('did-finish-load', () => {
    console.log('[main] did-finish-load')
    // Uncomment while debugging:
    // w.webContents.openDevTools({ mode: 'detach' });
  })

  w.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] did-fail-load', { code, desc, url })
  })

  w.on('closed', () => {
    console.log('[main] window closed')
    win = null
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  console.log('[main] loading URL:', devUrl)
  try {
    await w.loadURL(devUrl)
    console.log('[main] loadURL resolved')
  } catch (err) {
    console.error('[main] loadURL error:', err)
  }

  return w
}

app.whenReady().then(async () => {
  console.log('[main] app ready')

  // Try DB boot/migrations, but don’t block IPC if it fails
  try {
    openDb()
    try {
      const db = openDb()
      const cols = db.prepare('PRAGMA table_info(app_state)').all()
      console.log('[debug] app_state columns:', cols)
    } catch (e) {
      console.error('[debug] PRAGMA failed:', e)
    }
    runMigrations()
    console.log('[db boot] ok')
  } catch (e) {
    console.error('[db boot] failed:', e)
  }

  // Register IPC + start the M4 poller (Rules IPC is hooked inside registerSyncIpc)
  console.log('[main] registering IPC + scheduler')
  registerDbIpc()
  registerAuthIpc()
  registerSyncIpc()
  startScheduler() // uses default interval set in sync/index.ts

  console.log('[main] calling createWindow()')
  win = await createWindow()

  app.on('activate', async () => {
    console.log('[main] activate')
    if (BrowserWindow.getAllWindows().length === 0) {
      win = await createWindow()
    }
  })
})

// Standard macOS-ish quit behavior
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
