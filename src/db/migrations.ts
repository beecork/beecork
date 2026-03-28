import type Database from 'better-sqlite3';
import { logger } from '../util/logger.js';

interface Migration {
  version: number;
  description: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 2,
    description: 'Add user_id column for multi-user support',
    up: `
      ALTER TABLE tabs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE memories ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    `,
  },
  {
    version: 3,
    description: 'Add schema_version table',
    up: '', // Already handled by bootstrap
  },
  {
    version: 4,
    description: 'Add cron_jobs table in SQLite',
    up: `
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule TEXT NOT NULL,
        tab_name TEXT NOT NULL DEFAULT 'default',
        message TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        user_id TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT,
        next_run_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_user ON cron_jobs(user_id, enabled);
    `,
  },
  {
    version: 5,
    description: 'Add type column to pending_messages for notifications',
    up: `
      ALTER TABLE pending_messages ADD COLUMN type TEXT NOT NULL DEFAULT 'message';
      ALTER TABLE pending_messages ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local';
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL DEFAULT 1
    );
  `);

  // Get current version
  let row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(1);
    row = { version: 1 };
  }

  const currentVersion = row.version;

  // Apply pending migrations
  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;
    if (!migration.up) {
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
      continue;
    }

    logger.info(`DB migration v${migration.version}: ${migration.description}`);
    try {
      db.exec(migration.up);
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
    } catch (err) {
      // Column might already exist from a previous partial migration
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) {
        logger.info(`Migration v${migration.version}: columns already exist, skipping`);
        db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
      } else {
        throw err;
      }
    }
  }
}
