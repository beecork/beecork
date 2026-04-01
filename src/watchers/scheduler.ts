import fs from 'node:fs';
import path from 'node:path';
import { WatcherStore } from './store.js';
import { evaluateWatcher } from './evaluator.js';
import { execAsync, intervalToMs } from '../tasks/scheduler.js';
import { getBeecorkHome, getLogsDir } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { Watcher } from './types.js';

const WATCHER_RELOAD_SIGNAL_NAME = '.watcher-reload';

export class WatcherScheduler {
  private store = new WatcherStore();
  private intervals = new Map<string, NodeJS.Timeout>();
  public onNotify: ((text: string) => Promise<void>) | null = null;

  /** Load all watchers from store and schedule them */
  loadAndSchedule(): void {
    this.stopAll();

    const watchers = this.store.list();
    let scheduled = 0;

    for (const watcher of watchers) {
      if (!watcher.enabled) continue;

      const ms = parseScheduleToMs(watcher.schedule);
      if (!ms) {
        logger.error(`Watcher: invalid schedule for "${watcher.name}": ${watcher.schedule}`);
        continue;
      }

      const timer = setInterval(() => this.runCheck(watcher), ms);
      this.intervals.set(watcher.id, timer);
      scheduled++;
    }

    if (scheduled > 0 || watchers.length > 0) {
      logger.info(`Watchers: loaded ${scheduled} active watchers (${watchers.length} total)`);
    }
  }

  /** Check for the reload signal file and reload if present */
  checkForReload(): void {
    const signalPath = path.join(getBeecorkHome(), WATCHER_RELOAD_SIGNAL_NAME);
    if (fs.existsSync(signalPath)) {
      try { fs.unlinkSync(signalPath); } catch { /* race condition, ok */ }
      logger.info('Watchers: reload signal detected, reloading');
      this.loadAndSchedule();
    }
  }

  /** Stop all scheduled watchers */
  stopAll(): void {
    for (const [, timer] of this.intervals) {
      clearInterval(timer);
    }
    this.intervals.clear();
  }

  private async runCheck(watcher: Watcher): Promise<void> {
    const logFile = path.join(getLogsDir(), `watcher-${watcher.name}.log`);

    try {
      const result = await evaluateWatcher(watcher);
      this.store.markChecked(watcher.id);

      if (result.triggered) {
        this.store.markTriggered(watcher.id);
        await fs.promises.appendFile(logFile, `[${new Date().toISOString()}] TRIGGERED: ${result.output.slice(0, 500)}\n`);
        await this.executeAction(watcher, result.output);
      } else {
        await fs.promises.appendFile(logFile, `[${new Date().toISOString()}] OK: ${result.output.slice(0, 200)}\n`);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(`Watcher "${watcher.name}" check failed:`, err);
      await fs.promises.appendFile(logFile, `[${new Date().toISOString()}] ERROR: ${errMsg}\n`);
    }
  }

  private async executeAction(watcher: Watcher, output: string): Promise<void> {
    switch (watcher.action) {
      case 'notify':
        if (this.onNotify) {
          await this.onNotify(`Watcher "${watcher.name}" triggered:\n${output.slice(0, 500)}`);
        }
        break;

      case 'fix':
        if (watcher.actionDetails) {
          try {
            await execAsync(watcher.actionDetails, { timeout: 60000 });
            if (this.onNotify) {
              await this.onNotify(`Watcher "${watcher.name}" triggered and auto-fixed:\n${output.slice(0, 300)}`);
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.error(`Watcher "${watcher.name}" fix command failed:`, err);
            if (this.onNotify) {
              await this.onNotify(`Watcher "${watcher.name}" triggered but fix failed: ${errMsg}`);
            }
          }
        } else {
          logger.warn(`Watcher "${watcher.name}" has action=fix but no actionDetails`);
        }
        break;

      case 'delegate':
        // Write to pending_messages for the daemon to pick up
        if (watcher.actionDetails) {
          try {
            const { getDb } = await import('../db/index.js');
            const db = getDb();
            // actionDetails format: "tabName: message" or just a message for default tab
            const colonIdx = watcher.actionDetails.indexOf(':');
            let tabName = 'default';
            let message = watcher.actionDetails;
            if (colonIdx > 0 && colonIdx < 30) {
              tabName = watcher.actionDetails.slice(0, colonIdx).trim();
              message = watcher.actionDetails.slice(colonIdx + 1).trim();
            }
            const fullMessage = `[Watcher "${watcher.name}" triggered] ${message}\n\nWatcher output:\n${output.slice(0, 500)}`;
            db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(tabName, fullMessage, 'delegation');
            if (this.onNotify) {
              await this.onNotify(`Watcher "${watcher.name}" triggered -- delegated to tab:${tabName}`);
            }
          } catch (err) {
            logger.error(`Watcher "${watcher.name}" delegation failed:`, err);
          }
        }
        break;
    }
  }
}

/** Parse schedule string like "every 5m", "every 1h", or raw interval "30m" to milliseconds */
function parseScheduleToMs(schedule: string): number | null {
  // Strip "every " prefix if present
  const raw = schedule.replace(/^every\s+/i, '');
  return intervalToMs(raw);
}
