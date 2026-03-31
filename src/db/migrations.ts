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
  {
    version: 11,
    description: 'Add delegations table for multi-agent orchestration',
    up: `CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      source_tab TEXT NOT NULL,
      target_tab TEXT NOT NULL,
      message TEXT NOT NULL,
      return_to_tab TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      depth INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )`,
  },
  {
    version: 12,
    description: 'Add machines table for multi-machine routing',
    up: `CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT,
      ssh_user TEXT,
      project_paths TEXT,
      is_primary INTEGER DEFAULT 0,
      last_seen_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 13,
    description: 'Recreate projects table with new schema',
    up: `DROP TABLE IF EXISTS projects;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      path TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'user-project',
      last_used_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 14,
    description: 'Add routing_preferences table',
    up: `CREATE TABLE IF NOT EXISTS routing_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      project_name TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      hit_count INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 15,
    description: 'Add project_id to tabs',
    up: 'ALTER TABLE tabs ADD COLUMN project_id TEXT DEFAULT NULL',
  },
  {
    version: 16,
    description: 'Add payload_type to cron_jobs + routing pattern index',
    up: `ALTER TABLE cron_jobs ADD COLUMN payload_type TEXT DEFAULT 'agentTurn';
         CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_pattern ON routing_preferences(pattern, project_name);`,
  },
  {
    version: 17,
    description: 'Add index on messages.created_at for date-range cost queries',
    up: 'CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)',
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

    // Split multi-statement migrations and apply each safely
    // (handles partial failures from previous runs where some statements succeeded)
    const statements = migration.up.split(';').map(s => s.trim()).filter(s => s.length > 0);

    for (const stmt of statements) {
      try {
        // For ALTER TABLE ADD COLUMN, check if column already exists first
        const alterMatch = stmt.match(/ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(\S+)/i);
        if (alterMatch) {
          const columns = db.pragma(`table_info(${alterMatch[1]})`) as Array<{ name: string }>;
          if (columns.some(c => c.name === alterMatch[2])) {
            logger.debug(`Migration v${migration.version}: column ${alterMatch[1]}.${alterMatch[2]} already exists, skipping`);
            continue;
          }
        }
        db.exec(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('already exists')) {
          logger.debug(`Migration v${migration.version}: object already exists, skipping statement`);
          continue;
        }
        throw err;
      }
    }

    db.prepare('UPDATE schema_version SET version = ?').run(migration.version);
  }
}
