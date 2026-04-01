import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTabRecord } from '../../src/db/index.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  working_dir TEXT NOT NULL,
  pid INTEGER,
  system_prompt TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

describe('createTabRecord', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  it('should create a new tab with correct fields', () => {
    const result = createTabRecord(db, { name: 'research', workingDir: '/projects/ai' });

    expect(result.created).toBe(true);
    expect(result.name).toBe('research');
    expect(result.id).toBeTruthy();

    const row = db.prepare('SELECT * FROM tabs WHERE name = ?').get('research') as any;
    expect(row.name).toBe('research');
    expect(row.working_dir).toBe('/projects/ai');
    expect(row.status).toBe('idle');
    expect(row.system_prompt).toBeNull();
  });

  it('should return created: false for duplicate name', () => {
    createTabRecord(db, { name: 'myproject' });
    const result = createTabRecord(db, { name: 'myproject' });

    expect(result.created).toBe(false);
    expect(result.name).toBe('myproject');
    expect(result.id).toBe('');
  });

  it('should use HOME for default working dir', () => {
    const originalHome = process.env.HOME;
    process.env.HOME = '/home/testuser';

    try {
      createTabRecord(db, { name: 'test-tab' });
      const row = db.prepare('SELECT working_dir FROM tabs WHERE name = ?').get('test-tab') as any;
      expect(row.working_dir).toBe('/home/testuser');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('should fall back to "/" when HOME is not set', () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;

    try {
      createTabRecord(db, { name: 'fallback-tab' });
      const row = db.prepare('SELECT working_dir FROM tabs WHERE name = ?').get('fallback-tab') as any;
      expect(row.working_dir).toBe('/');
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it('should store systemPrompt when provided', () => {
    createTabRecord(db, { name: 'custom', systemPrompt: 'You are a coding assistant.' });

    const row = db.prepare('SELECT system_prompt FROM tabs WHERE name = ?').get('custom') as any;
    expect(row.system_prompt).toBe('You are a coding assistant.');
  });

  it('should store null systemPrompt when not provided', () => {
    createTabRecord(db, { name: 'plain' });

    const row = db.prepare('SELECT system_prompt FROM tabs WHERE name = ?').get('plain') as any;
    expect(row.system_prompt).toBeNull();
  });

  it('should generate unique IDs for different tabs', () => {
    const r1 = createTabRecord(db, { name: 'tab-a' });
    const r2 = createTabRecord(db, { name: 'tab-b' });

    expect(r1.id).not.toBe(r2.id);
    expect(r1.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r2.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should set session_id as a valid UUID', () => {
    createTabRecord(db, { name: 'session-check' });

    const row = db.prepare('SELECT session_id FROM tabs WHERE name = ?').get('session-check') as any;
    expect(row.session_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
