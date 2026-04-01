import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../../src/db/index.js', () => ({
  getDb: () => testDb,
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false), // no JSON migration file
    readFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}));

vi.mock('../../src/util/paths.js', () => ({
  getCrontabPath: () => '/tmp/crontab.json',
  getBeecorkHome: () => '/tmp/.beecork',
}));

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { TaskStore } from '../../src/tasks/store.js';

const TASKS_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule TEXT NOT NULL,
  tab_name TEXT NOT NULL DEFAULT 'default',
  message TEXT NOT NULL,
  payload_type TEXT DEFAULT 'agentTurn',
  enabled INTEGER NOT NULL DEFAULT 1,
  user_id TEXT NOT NULL DEFAULT 'local',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at TEXT,
  next_run_at TEXT
);
`;

describe('TaskStore', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.exec(TASKS_SCHEMA);
  });

  afterEach(() => {
    testDb.close();
  });

  it('should list all tasks for local user', () => {
    const store = new TaskStore();
    testDb.exec(`INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, user_id) VALUES ('t1', 'test', 'cron', '* * * * *', 'default', 'hello', 'local')`);

    const tasks = store.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].name).toBe('test');
    expect(tasks[0].scheduleType).toBe('cron');
  });

  it('should get task by ID', () => {
    const store = new TaskStore();
    testDb.exec(`INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, user_id) VALUES ('t1', 'test', 'cron', '* * * * *', 'default', 'hello', 'local')`);

    const task = store.get('t1');
    expect(task).toBeDefined();
    expect(task!.id).toBe('t1');
    expect(task!.enabled).toBe(true);
  });

  it('should return undefined for missing ID', () => {
    const store = new TaskStore();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('should add a task', () => {
    const store = new TaskStore();
    store.add({
      id: 'new-1', name: 'new-task', scheduleType: 'every', schedule: '30m',
      tabName: 'default', message: 'do something', payloadType: 'agentTurn',
      enabled: true, createdAt: new Date().toISOString(), lastRunAt: null, nextRunAt: null,
    });

    const task = store.get('new-1');
    expect(task).toBeDefined();
    expect(task!.name).toBe('new-task');
    expect(task!.schedule).toBe('30m');
  });

  it('should update a task', () => {
    const store = new TaskStore();
    testDb.exec(`INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, user_id) VALUES ('t1', 'test', 'cron', '* * * * *', 'default', 'hello', 'local')`);

    const success = store.update('t1', { name: 'updated', enabled: false });
    expect(success).toBe(true);

    const task = store.get('t1');
    expect(task!.name).toBe('updated');
    expect(task!.enabled).toBe(false);
  });

  it('should return false when updating missing ID', () => {
    const store = new TaskStore();
    expect(store.update('nonexistent', { name: 'x' })).toBe(false);
  });

  it('should delete a task', () => {
    const store = new TaskStore();
    testDb.exec(`INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, user_id) VALUES ('t1', 'test', 'cron', '* * * * *', 'default', 'hello', 'local')`);

    expect(store.delete('t1')).toBe(true);
    expect(store.get('t1')).toBeUndefined();
  });

  it('should return false when deleting missing ID', () => {
    const store = new TaskStore();
    expect(store.delete('nonexistent')).toBe(false);
  });
});
