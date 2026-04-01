import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { getDbPath, ensureBeecorkDirs } from '../util/paths.js';
import { runMigrations } from './migrations.js';
import { logger } from '../util/logger.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  working_dir TEXT NOT NULL,
  pid INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_id TEXT NOT NULL REFERENCES tabs(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  cost_usd REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_tab ON messages(tab_id, created_at);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  tab_name TEXT,
  source TEXT NOT NULL DEFAULT 'tool',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tab_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pending_unprocessed ON pending_messages(processed, created_at);
`;

let db: Database.Database | null = null;
let walInterval: NodeJS.Timeout | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  ensureBeecorkDirs();
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  runMigrations(db);

  // Periodic WAL checkpointing + table cleanup
  walInterval = setInterval(() => {
    try {
      db?.pragma('wal_checkpoint(PASSIVE)');
      // Prune old routing/permission history (keep last 1000 entries)
      db?.exec('DELETE FROM routing_history WHERE created_at < (SELECT created_at FROM routing_history ORDER BY created_at DESC LIMIT 1 OFFSET 999)');
      db?.exec('DELETE FROM permission_history WHERE created_at < (SELECT created_at FROM permission_history ORDER BY created_at DESC LIMIT 1 OFFSET 999)');
      db?.exec("DELETE FROM activity_log WHERE created_at < datetime('now', '-90 days')");
    } catch (err) {
      logger.warn('WAL checkpoint/cleanup error:', err);
    }
  }, 30 * 60 * 1000); // every 30 minutes

  return db;
}

export interface CreateTabOptions {
  name: string;
  workingDir?: string;
  systemPrompt?: string | null;
}

/** Shared tab record creation — used by dashboard, MCP, and TabManager */
export function createTabRecord(db: Database.Database, opts: CreateTabOptions): { id: string; name: string; created: boolean } {
  const existing = db.prepare('SELECT name FROM tabs WHERE name = ?').get(opts.name) as { name: string } | undefined;
  if (existing) return { id: '', name: opts.name, created: false };

  const id = crypto.randomUUID();
  const dir = opts.workingDir || process.env.HOME || '/';
  db.prepare(
    'INSERT INTO tabs (id, name, session_id, status, working_dir, system_prompt) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, opts.name, crypto.randomUUID(), 'idle', dir, opts.systemPrompt || null);
  return { id, name: opts.name, created: true };
}

export function closeDb(): void {
  if (walInterval) { clearInterval(walInterval); walInterval = null; }
  if (db) {
    db.close();
    db = null;
  }
}
