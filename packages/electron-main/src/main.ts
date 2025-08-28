import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { openDb } from './db'
import { runMigrations } from './db/migrate'
import { registerDbIpc } from './ipc'

let win: BrowserWindow | null = null

async function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 740,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'), // built file
    },
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  await win.loadURL(devUrl)

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(async () => {
  openDb()
  runMigrations()
  registerDbIpc()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
