import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './index'

export function runMigrations() {
  const db = openDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const dir = path.join(__dirname, 'migrations')
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()

  const seen = new Set<string>(
    db
      .prepare(`SELECT id FROM _migrations ORDER BY id`)
      .all()
      .map((r) => r.id),
  )

  const apply = db.prepare(
    `INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`,
  )
  db.exec('BEGIN')
  try {
    for (const file of files) {
      if (seen.has(file)) continue
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      db.exec(sql)
      apply.run(file, Date.now())
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
