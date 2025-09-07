// packages/electron-main/src/db/migrate.ts
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './index'

function resolveMigrationsDir(): string {
  // When compiled: dist/db/migrations
  const distDir = path.join(__dirname, 'migrations')
  if (fs.existsSync(distDir)) return distDir

  // During dev (ts-node): packages/electron-main/src/db/migrations
  const devDir = path.resolve(process.cwd(), 'src', 'db', 'migrations')
  if (fs.existsSync(devDir)) return devDir

  // Fallback (rare)
  return path.join(__dirname, '..', 'src', 'db', 'migrations')
}

export function runMigrations() {
  const db = openDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `)

  const dir = resolveMigrationsDir()
  if (!fs.existsSync(dir)) return // nothing to run

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/i.test(f))
    .sort()

  type MigRow = { id: string }
  const appliedRows = db
    .prepare(`SELECT id FROM _migrations ORDER BY id`)
    .all() as MigRow[]
  const seen = new Set<string>(appliedRows.map((r) => r.id))

  const apply = db.prepare(
    `INSERT INTO _migrations (id, applied_at) VALUES (?, ?)`,
  )

  for (const file of files) {
    if (seen.has(file)) continue

    // Run each migration in its own transaction
    db.exec('BEGIN')
    try {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      db.exec(sql) // supports multi-statement SQL
      apply.run(file, Date.now()) // record as applied
      db.exec('COMMIT')
      console.log(`[db] Applied migration: ${file}`)
    } catch (e) {
      db.exec('ROLLBACK')
      console.warn(
        `[db] Migration ${file} failed, but continuing:`,
        e instanceof Error ? e.message : String(e),
      )
      // Continue with other migrations instead of failing completely
      // This allows the system to recover from individual migration failures
    }
  }
}
