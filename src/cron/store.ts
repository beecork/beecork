import fs from 'node:fs';
import { getDb } from '../db/index.js';
import { getCrontabPath } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { CronJob } from '../types.js';

// SQLite row uses snake_case
interface CronJobRow {
  id: string; name: string; schedule_type: string; schedule: string;
  tab_name: string; message: string; enabled: number; user_id: string;
  payload_type?: string;
  created_at: string; last_run_at: string | null; next_run_at: string | null;
}

function rowToJob(row: CronJobRow): CronJob {
  return {
    id: row.id, name: row.name,
    scheduleType: row.schedule_type as CronJob['scheduleType'],
    schedule: row.schedule, tabName: row.tab_name, message: row.message,
    payloadType: (row.payload_type as CronJob['payloadType']) || 'agentTurn',
    enabled: row.enabled === 1, createdAt: row.created_at,
    lastRunAt: row.last_run_at, nextRunAt: row.next_run_at,
  };
}

export class CronStore {
  constructor() {
    this.migrateFromJson();
  }

  list(): CronJob[] {
    const db = getDb();
    return (db.prepare('SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at').all('local') as CronJobRow[]).map(rowToJob);
  }

  get(id: string): CronJob | undefined {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cron_jobs WHERE id = ?').get(id) as CronJobRow | undefined;
    return row ? rowToJob(row) : undefined;
  }

  add(job: CronJob): void {
    const db = getDb();
    db.prepare(`INSERT INTO cron_jobs (id, name, schedule_type, schedule, tab_name, message, enabled, user_id, created_at, last_run_at, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      job.id, job.name, job.scheduleType, job.schedule, job.tabName, job.message,
      job.enabled ? 1 : 0, 'local', job.createdAt, job.lastRunAt, job.nextRunAt,
    );
  }

  update(id: string, updates: Partial<CronJob>): boolean {
    const db = getDb();
    const existing = this.get(id);
    if (!existing) return false;

    const merged = { ...existing, ...updates };
    db.prepare(`UPDATE cron_jobs SET name=?, schedule_type=?, schedule=?, tab_name=?, message=?, enabled=?, last_run_at=?, next_run_at=? WHERE id=?`).run(
      merged.name, merged.scheduleType, merged.schedule, merged.tabName, merged.message,
      merged.enabled ? 1 : 0, merged.lastRunAt, merged.nextRunAt, id,
    );
    return true;
  }

  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /** One-time migration from crontab.json to SQLite */
  private migrateFromJson(): void {
    const jsonPath = getCrontabPath();
    if (!fs.existsSync(jsonPath)) return;

    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as count FROM cron_jobs').get() as { count: number };
    if (count.count > 0) {
      // Already migrated, clean up JSON
      try { fs.renameSync(jsonPath, jsonPath + '.bak'); } catch { /* ok */ }
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const jobs = data.jobs || [];
      if (jobs.length === 0) return;

      const insert = db.prepare(`INSERT OR IGNORE INTO cron_jobs (id, name, schedule_type, schedule, tab_name, message, enabled, user_id, created_at, last_run_at, next_run_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      const tx = db.transaction(() => {
        for (const j of jobs) {
          insert.run(j.id, j.name, j.scheduleType, j.schedule, j.tabName || 'default', j.message,
            j.enabled ? 1 : 0, 'local', j.createdAt, j.lastRunAt, j.nextRunAt);
        }
      });
      tx();

      fs.renameSync(jsonPath, jsonPath + '.bak');
      logger.info(`Migrated ${jobs.length} cron jobs from JSON to SQLite`);
    } catch (err) {
      logger.error('Failed to migrate cron jobs from JSON:', err);
    }
  }
}
