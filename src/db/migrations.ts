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
  {
    version: 6,
    description: 'Add pipe intelligence tables (projects, preferences, permissions, routing)',
    up: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        description TEXT DEFAULT '',
        languages TEXT DEFAULT '[]',
        last_used TEXT,
        tab_name TEXT,
        discovered_via TEXT DEFAULT 'scan',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
      CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS permission_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        tool_args_pattern TEXT NOT NULL,
        decision TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        context TEXT,
        tab_name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_permissions_tool ON permission_history(tool_name, created_at);

      CREATE TABLE IF NOT EXISTS routing_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_preview TEXT NOT NULL,
        tab_name TEXT NOT NULL,
        project_path TEXT,
        confidence REAL NOT NULL,
        was_correct INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_routing_tab ON routing_history(tab_name, created_at);
    `,
  },
  {
    version: 7,
    description: 'Add delivery tracking columns to messages',
    up: `ALTER TABLE messages ADD COLUMN delivery_status TEXT DEFAULT 'sent';
         ALTER TABLE messages ADD COLUMN retry_count INTEGER DEFAULT 0;`,
  },
  {
    version: 8,
    description: 'Add system_prompt column to tabs',
    up: "ALTER TABLE tabs ADD COLUMN system_prompt TEXT DEFAULT NULL",
  },
  {
    version: 9,
    description: 'Add users table',
    up: `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      budget_usd REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 10,
    description: 'Add identities table for cross-channel identity',
    up: `CREATE TABLE IF NOT EXISTS identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id),
      channel_id TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(channel_id, peer_id)
    )`,
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
