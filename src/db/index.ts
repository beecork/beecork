import Database from 'better-sqlite3';
import { getDbPath, ensureBeecorkDirs } from '../util/paths.js';
import { runMigrations } from './migrations.js';

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

export function getDb(): Database.Database {
  if (db) return db;

  ensureBeecorkDirs();
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  runMigrations(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
