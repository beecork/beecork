import { getDb } from '../db/index.js';
import type { Watcher } from './types.js';

interface WatcherRow {
  id: string;
  name: string;
  description: string | null;
  check_command: string;
  condition: string;
  action: string;
  action_details: string | null;
  schedule: string;
  last_check_at: string | null;
  last_triggered_at: string | null;
  trigger_count: number;
  enabled: number;
  created_at: string;
}

function rowToWatcher(row: WatcherRow): Watcher {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    checkCommand: row.check_command,
    condition: row.condition,
    action: row.action as Watcher['action'],
    actionDetails: row.action_details,
    schedule: row.schedule,
    lastCheckAt: row.last_check_at,
    lastTriggeredAt: row.last_triggered_at,
    triggerCount: row.trigger_count,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export class WatcherStore {
  list(): Watcher[] {
    const db = getDb();
    return (db.prepare('SELECT * FROM watchers ORDER BY created_at').all() as WatcherRow[]).map(rowToWatcher);
  }

  get(id: string): Watcher | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM watchers WHERE id = ?').get(id) as WatcherRow | undefined;
    return row ? rowToWatcher(row) : undefined;
  }

  create(watcher: Omit<Watcher, 'lastCheckAt' | 'lastTriggeredAt' | 'triggerCount' | 'enabled' | 'createdAt'>): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO watchers (id, name, description, check_command, condition, action, action_details, schedule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      watcher.id, watcher.name, watcher.description, watcher.checkCommand,
      watcher.condition, watcher.action, watcher.actionDetails, watcher.schedule,
    );
  }

  update(id: string, fields: Partial<Watcher>): boolean {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return false;

    const merged = { ...existing, ...fields };
    db.prepare(
      `UPDATE watchers SET name=?, description=?, check_command=?, condition=?, action=?, action_details=?, schedule=?, enabled=? WHERE id=?`
    ).run(
      merged.name, merged.description, merged.checkCommand, merged.condition,
      merged.action, merged.actionDetails, merged.schedule, merged.enabled ? 1 : 0, id,
    );
    return true;
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM watchers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  markChecked(id: string): void {
    const db = getDb();
    db.prepare('UPDATE watchers SET last_check_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  markTriggered(id: string): void {
    const db = getDb();
    db.prepare(
      'UPDATE watchers SET last_triggered_at = ?, trigger_count = trigger_count + 1 WHERE id = ?'
    ).run(new Date().toISOString(), id);
  }
}
