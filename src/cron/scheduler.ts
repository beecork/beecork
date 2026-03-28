import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import { CronStore } from './store.js';
import { getCronReloadSignalPath, getLogsDir } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { TabManager } from '../session/manager.js';
import type { BeecorkTelegramBot } from '../telegram/bot.js';
import type { CronJob } from '../types.js';

interface Stoppable {
  stop: () => void;
}

export class CronScheduler {
  private scheduledJobs: Map<string, Stoppable> = new Map();
  private store = new CronStore();

  constructor(
    private tabManager: TabManager,
    private telegramBot: BeecorkTelegramBot | null,
  ) {}

  /** Load all cron jobs from store and schedule them */
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
          logger.warn(`Cron: missed fire detected for "${job.name}" (was scheduled for ${job.schedule}), firing now`);
          missedFires++;
          this.fireJob(job);
          this.store.update(job.id, { enabled: false }); // Disable after one-time execution
          continue;
        }
      }

      this.scheduleJob(job);
      scheduled++;
    }

    logger.info(`Cron: loaded ${scheduled} active jobs (${jobs.length} total)${missedFires > 0 ? `, fired ${missedFires} missed` : ''}`);
  }

  /** Check for the reload signal file and reload if present */
  checkForReload(): void {
    const signalPath = getCronReloadSignalPath();
    if (fs.existsSync(signalPath)) {
      try { fs.unlinkSync(signalPath); } catch { /* race condition, ok */ }
      logger.info('Cron: reload signal detected, reloading schedules');
      this.loadAndSchedule();
    }
  }

  /** Stop all scheduled jobs */
  stopAll(): void {
    for (const [, task] of this.scheduledJobs) {
      task.stop();
    }
    this.scheduledJobs.clear();
  }

  private scheduleJob(job: CronJob): void {
    switch (job.scheduleType) {
      case 'cron': {
        if (!cron.validate(job.schedule)) {
          logger.error(`Cron: invalid expression for "${job.name}": ${job.schedule}`);
          return;
        }
        const task = cron.schedule(job.schedule, () => this.fireJob(job));
        this.scheduledJobs.set(job.id, task);
        break;
      }

      case 'every': {
        const cronExpr = intervalToCron(job.schedule);
        if (!cronExpr || !cron.validate(cronExpr)) {
          logger.error(`Cron: invalid interval for "${job.name}": ${job.schedule}`);
          return;
        }
        const task = cron.schedule(cronExpr, () => this.fireJob(job));
        this.scheduledJobs.set(job.id, task);
        break;
      }

      case 'at': {
        const targetTime = new Date(job.schedule).getTime();
        const delay = targetTime - Date.now();
        if (delay <= 0) {
          logger.warn(`Cron: one-time job "${job.name}" is in the past, skipping`);
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

  private async fireJob(job: CronJob): Promise<void> {
    logger.info(`Cron firing: "${job.name}" (${job.payloadType || 'agentTurn'}) → tab:${job.tabName}`);
    const logFile = path.join(getLogsDir(), `cron-${job.name}.log`);

    // Handle systemEvent — internal Beecork actions, not Claude Code
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

      // Notify via Telegram
      if (this.telegramBot) {
        if (result.error) {
          await this.telegramBot.sendNotification(`❌ [${job.name}] Failed — ${firstLine}`);
        } else {
          await this.telegramBot.sendNotification(`✅ [${job.name}] Done — ${firstLine}`);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Cron job "${job.name}" failed:`, err);
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ERROR: ${errMsg}\n`);

      if (this.telegramBot) {
        await this.telegramBot.sendNotification(`❌ [${job.name}] Failed — ${errMsg}`);
      }
    }
  }

  private async handleSystemEvent(job: CronJob): Promise<void> {
    switch (job.message) {
      case 'health_check':
        logger.info('System event: health check — daemon alive');
        if (this.telegramBot) {
          await this.telegramBot.sendNotification('🟢 Beecork health check: all systems operational');
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

  // Combined intervals (e.g., 1h30m = every 90 minutes)
  if (totalMins <= 1440) return `*/${totalMins} * * * *`; // up to 24h as minutes

  // Fallback for very large intervals: daily
  return `0 0 */${Math.ceil(totalMins / 1440)} * *`;
}
