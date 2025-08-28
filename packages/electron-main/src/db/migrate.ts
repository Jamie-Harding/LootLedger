import fs from 'node:fs'
import path from 'node:path'
import { openDb } from './index'

function resolveMigrationsDir(): string {
  // 1) When compiled: dist/db/migrations
  const distDir = path.join(__dirname, 'migrations')
  if (fs.existsSync(distDir)) return distDir

  // 2) During dev (running TS via build+start): packages/electron-main/src/db/migrations
  // pnpm runs the package scripts with CWD = packages/electron-main
  const devDir = path.resolve(process.cwd(), 'src', 'db', 'migrations')
  if (fs.existsSync(devDir)) return devDir

  // 3) Fallback: sibling to current file (useful if tooling shifts)
  const fallback = path.join(__dirname, '..', 'src', 'db', 'migrations')
  return fallback
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
  if (!fs.existsSync(dir)) {
    // No migrations to run yet—nothing to do.
    return
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()

  // Help TS understand the shape of rows returned by .all()
  type MigRow = { id: string }
  const applied = db
    .prepare(`SELECT id FROM _migrations ORDER BY id`)
    .all() as MigRow[]
  const seen = new Set<string>(
    db
      .prepare(`SELECT id FROM _migrations ORDER BY id`)
      .all()
      .map((r: { id: string }) => r.id),
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
