import { app } from 'electron'
import { runMigrations } from './db/migrate'
import { openDb } from './db'
import { registerDbIpc } from './ipc'

app.whenReady().then(() => {
  openDb()
  runMigrations()
  registerDbIpc()
  // ...create windows etc.
})
