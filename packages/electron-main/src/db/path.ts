import { app } from 'electron'
import path from 'node:path'
export function getDbPath() {
  const dir = app.getPath('userData')
  return path.join(dir, 'loot-ledger.sqlite3')
}
