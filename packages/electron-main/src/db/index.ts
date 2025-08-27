import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path' // ⬅ add this
import { getDbPath } from './path'

let db: Database.Database | null = null

export function openDb() {
  if (db) return db
  const file = getDbPath()
  // ⬇ replace require('node:path').dirname(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export function closeDb() {
  if (db) db.close()
  db = null
}
