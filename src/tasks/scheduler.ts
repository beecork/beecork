import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { TaskStore } from './store.js';
import { getCronReloadSignalPath, getLogsDir } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { TabManager, NotifyCallback } from '../session/manager.js';
import type { Task } from '../types.js';

export const execAsync = promisify(exec);

interface Stoppable {
  stop: () => void;
}

export class TaskScheduler {
  private scheduledJobs: Map<string, Stoppable> = new Map();
  private store = new TaskStore();

  constructor(
    private tabManager: TabManager,
    private onNotify: NotifyCallback | null,
  ) {}

  /** Load all tasks from store and schedule them */
  loadAndSchedule(): void {
    // Cancel existing
    for (const [, task] of this.scheduledJobs) {
      task.stop();
    }
    this.scheduledJobs.clear();

    const jobs = this.store.list();
    let scheduled = 0;
    let missedFires = 0;

    for (const job of jobs) {
      if (!job.enabled) continue;

      // Detect missed fires: one-time "at" jobs whose time has passed but never ran
      if (job.scheduleType === 'at' && !job.lastRunAt) {
        const targetTime = new Date(job.schedule).getTime();
        if (targetTime <= Date.now()) {
          logger.warn(`Task: missed fire detected for "${job.name}" (was scheduled for ${job.schedule}), firing now`);
          missedFires++;
          this.fireJob(job);
          this.store.update(job.id, { enabled: false }); // Disable after one-time execution
          continue;
        }
      }

      this.scheduleJob(job);
      scheduled++;
    }

    logger.info(`Tasks: loaded ${scheduled} active tasks (${jobs.length} total)${missedFires > 0 ? `, fired ${missedFires} missed` : ''}`);
  }

  /** Check for the reload signal file and reload if present */
  checkForReload(): void {
    const signalPath = getCronReloadSignalPath();
    if (fs.existsSync(signalPath)) {
      try { fs.unlinkSync(signalPath); } catch { /* race condition, ok */ }
      logger.info('Tasks: reload signal detected, reloading schedules');
      this.loadAndSchedule();
    }
  }

  /** Stop all scheduled tasks */
  stopAll(): void {
    for (const [, task] of this.scheduledJobs) {
      task.stop();
    }
    this.scheduledJobs.clear();
  }

  private scheduleJob(job: Task): void {
    switch (job.scheduleType) {
      case 'cron': {
        if (!cron.validate(job.schedule)) {
          logger.error(`Task: invalid expression for "${job.name}": ${job.schedule}`);
          return;
        }
        const task = cron.schedule(job.schedule, () => this.fireJob(job));
        this.scheduledJobs.set(job.id, task);
        break;
      }

      case 'every': {
        const cronExpr = intervalToCron(job.schedule);
        if (cronExpr) {
          if (!cron.validate(cronExpr)) {
            logger.error(`Task: invalid cron expression for "${job.name}": ${cronExpr}`);
            return;
          }
          const task = cron.schedule(cronExpr, () => this.fireJob(job));
          this.scheduledJobs.set(job.id, task);
        } else {
          // Use setInterval for non-cron-expressible intervals
          const totalMs = intervalToMs(job.schedule);
          if (totalMs) {
            const timer = setInterval(() => this.fireJob(job), totalMs);
            this.scheduledJobs.set(job.id, { stop: () => clearInterval(timer) });
          } else {
            logger.error(`Task: invalid interval for "${job.name}": ${job.schedule}`);
          }
        }
        break;
      }

      case 'at': {
        const targetTime = new Date(job.schedule).getTime();
        const delay = targetTime - Date.now();
        if (delay <= 0) {
          logger.warn(`Task: one-time task "${job.name}" is in the past, skipping`);
          return;
        }
        const timer = setTimeout(() => {
          this.fireJob(job);
          this.store.update(job.id, { enabled: false });
        }, delay);
        this.scheduledJobs.set(job.id, { stop: () => clearTimeout(timer) });
        break;
      }
    }
  }

  private async fireJob(job: Task): Promise<void> {
    logger.info(`Task firing: "${job.name}" (${job.payloadType || 'agentTurn'}) -> tab:${job.tabName}`);
    const logFile = path.join(getLogsDir(), `task-${job.name}.log`);

    // Handle systemEvent -- internal Beecork actions, not Claude Code
    if (job.payloadType === 'systemEvent') {
      try {
        await this.handleSystemEvent(job);
        this.store.update(job.id, { lastRunAt: new Date().toISOString() });
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] SYSTEM: ${job.message}\n`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error(`System event "${job.name}" failed:`, err);
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERROR: ${errMsg}\n`);
      }
      return;
    }

    try {
      this.tabManager.ensureTab(job.tabName);
      const result = await this.tabManager.sendMessage(job.tabName, job.message);

      this.store.update(job.id, { lastRunAt: new Date().toISOString() });

      const firstLine = result.text.split('\n')[0]?.slice(0, 200) || '(no output)';

      // Log result
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] SUCCESS: ${firstLine}\n`);

      // Notify (separate try/catch -- notification failure shouldn't be reported as job failure)
      try {
        if (this.onNotify) {
          if (result.error) {
            await this.onNotify(`[${job.name}] Failed -- ${firstLine}`);
          } else {
            await this.onNotify(`[${job.name}] Done -- ${firstLine}`);
          }
        }
      } catch (notifyErr) {
        logger.warn(`Task "${job.name}" notification failed:`, notifyErr);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Task "${job.name}" failed:`, err);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERROR: ${errMsg}\n`);

      try {
        await this.onNotify?.(`[${job.name}] Failed -- ${errMsg}`);
      } catch { /* notification best-effort */ }
    }
  }

  private async handleSystemEvent(job: Task): Promise<void> {
    switch (job.message) {
      case 'health_check':
        logger.info('System event: health check -- daemon alive');
        if (this.onNotify) {
          await this.onNotify('Beecork health check: all systems operational');
        }
        break;
      case 'memory_compaction':
        logger.info('System event: memory compaction (not yet implemented)');
        break;
      default:
        logger.warn(`Unknown system event: ${job.message}`);
    }
  }
}

/** @deprecated Use TaskScheduler */
export { TaskScheduler as CronScheduler };

/** Convert human interval (30m, 2h, 1d, 1h30m, 2w) to milliseconds */
export function intervalToMs(interval: string): number | null {
  const match = interval.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || match.slice(1).every(g => g === undefined)) return null;

  const weeks = parseInt(match[1] || '0', 10);
  const days = parseInt(match[2] || '0', 10);
  const hours = parseInt(match[3] || '0', 10);
  const mins = parseInt(match[4] || '0', 10);

  const totalMs = ((weeks * 7 * 24 * 60) + (days * 24 * 60) + (hours * 60) + mins) * 60 * 1000;
  return totalMs > 0 ? totalMs : null;
}

/** Convert human interval (30m, 2h, 1d, 1h30m, 2w) to cron expression */
export function intervalToCron(interval: string): string | null {
  // Try combined format: 1h30m, 2h, 30m, 1d, 2w
  const match = interval.match(/^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/);
  if (!match || match.slice(1).every(g => g === undefined)) return null;

  const weeks = parseInt(match[1] || '0', 10);
  const days = parseInt(match[2] || '0', 10);
  const hours = parseInt(match[3] || '0', 10);
  const mins = parseInt(match[4] || '0', 10);

  // Convert to total minutes for simple intervals
  const totalMins = weeks * 7 * 24 * 60 + days * 24 * 60 + hours * 60 + mins;
  if (totalMins <= 0) return null;

  // Simple minute interval
  if (totalMins <= 59) return `*/${totalMins} * * * *`;
  // Hourly intervals
  if (mins === 0 && days === 0 && weeks === 0 && hours > 0 && hours <= 23) return `0 */${hours} * * *`;
  // Daily intervals
  if (mins === 0 && hours === 0 && weeks === 0 && days > 0) return `0 0 */${days} * *`;
  // Weekly intervals
  if (mins === 0 && hours === 0 && days === 0 && weeks > 0) return `0 0 * * 0`;

  // Combined or large intervals -- return null, handled by setInterval in scheduleJob
  return null;
}
