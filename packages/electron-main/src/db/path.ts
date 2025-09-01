import { app } from 'electron'
import path from 'node:path'

export function getDbPath() {
  const dir = app.getPath('userData')
  const full = path.join(dir, 'loot-ledger.sqlite3')
  console.log('[db]', full)
  return full
}
