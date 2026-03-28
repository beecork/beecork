import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { TabManager } from './session/manager.js';
import { BeecorkTelegramBot } from './telegram/bot.js';
import { CronScheduler } from './cron/scheduler.js';
import { ensureBeecorkDirs, getPidPath, getBeecorkHome } from './util/paths.js';
import { logger } from './util/logger.js';

let tabManager: TabManager;
let telegramBot: BeecorkTelegramBot | null = null;
let cronScheduler: CronScheduler;
let pollInterval: ReturnType<typeof setInterval>;

/** Migrate data from old ~/.clawd to ~/.beecork if needed */
function migrateFromClawd(): void {
  const oldHome = path.join(os.homedir(), '.clawd');
  const newHome = getBeecorkHome();
  if (fs.existsSync(oldHome) && !fs.existsSync(newHome)) {
    // Copy old data to new location
    fs.cpSync(oldHome, newHome, { recursive: true });
    logger.info(`Migrated data directory from ${oldHome} to ${newHome}`);
  }
}

async function main(): Promise<void> {
  migrateFromClawd();
  ensureBeecorkDirs();
  logger.setLogFile('daemon.log');

  // Check for existing daemon — prevent double instances
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    const existingPid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    if (existingPid && existingPid !== process.pid) {
      try {
        process.kill(existingPid, 0); // Check if alive
        logger.error(`Another daemon is already running (PID ${existingPid}). Exiting.`);
        process.exit(1);
      } catch {
        // Process is dead, stale PID file — continue
      }
    }
  }

  logger.info('Beecork daemon starting...');

  // 1. Load config
  const config = getConfig();

  // 2. Initialize database
  getDb();

  // 3. Write PID file
  fs.writeFileSync(pidPath, String(process.pid));
  logger.info(`PID file written: ${process.pid}`);

  // 4. Create TabManager
  tabManager = new TabManager(config);

  // 5. Ensure default tab
  tabManager.ensureTab('default');

  // 6. Recover crashed tabs
  await recoverCrashedTabs();

  // 7. Start Telegram bot
  if (config.telegram?.token) {
    try {
      telegramBot = new BeecorkTelegramBot(config, tabManager);
      // Wire up notifications so TabManager can send Telegram alerts (loop detection, etc.)
      tabManager.setNotifyCallback((text) => telegramBot!.sendNotification(text));
    } catch (err) {
      logger.error('Failed to start Telegram bot:', err);
    }
  } else {
    logger.warn('No Telegram token configured. Bot not started.');
  }

  // 8. Start cron scheduler
  cronScheduler = new CronScheduler(tabManager, telegramBot);
  cronScheduler.loadAndSchedule();

  // 9. Start IPC polling
  pollInterval = setInterval(() => {
    try {
      cronScheduler.checkForReload();
      tabManager.processPendingMessages();
    } catch (err) {
      logger.error('Poll error:', err);
    }
  }, 5000);

  // 10. Handle shutdown
  const shutdown = async () => {
    logger.info('Beecork daemon shutting down...');

    // Send shutdown notification before stopping
    if (telegramBot) {
      try { await telegramBot.sendNotification('🔴 Beecork stopping'); } catch { /* ok */ }
    }

    clearInterval(pollInterval);
    tabManager.stopAll();
    if (telegramBot) telegramBot.stop();
    cronScheduler.stopAll();
    closeDb();

    const pidPath = getPidPath();
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);

    logger.info('Beecork daemon stopped.');
    logger.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info(`Beecork daemon ready (home: ${getBeecorkHome()})`);

  // Send detailed startup notification
  if (telegramBot) {
    const tabs = tabManager.listTabs();
    const cronJobs = new (await import('./cron/store.js')).CronStore().list().filter(j => j.enabled);
    await telegramBot.sendNotification(
      `🟢 Beecork started — ${cronJobs.length} cron job${cronJobs.length !== 1 ? 's' : ''}, ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`
    );
  }
}

async function recoverCrashedTabs(): Promise<void> {
  const db = getDb();

  // Find tabs that were running when daemon stopped (uses snake_case from SQLite)
  interface TabRow { id: string; name: string; session_id: string; status: string; }
  const crashedRows = db.prepare(
    `SELECT * FROM tabs WHERE status = 'running'`
  ).all() as TabRow[];

  if (crashedRows.length === 0) return;

  logger.info(`Found ${crashedRows.length} tabs that were running when daemon stopped`);

  for (const row of crashedRows) {
    logger.info(`Recovering tab: ${row.name} (session: ${row.session_id})`);

    // Get last few messages for context
    const recentMessages = db.prepare(
      `SELECT role, content FROM messages
       WHERE tab_id = ? ORDER BY created_at DESC LIMIT 5`
    ).all(row.id) as Array<{ role: string; content: string }>;

    // Build recovery prompt
    const contextSummary = recentMessages
      .reverse()
      .map(m => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');

    const recoveryPrompt = [
      `[SYSTEM: Session recovered after restart. Here is your recent conversation context:]`,
      contextSummary,
      `[SYSTEM: Please acknowledge you are back and ready for new instructions.]`,
    ].join('\n');

    // Reset status so TabManager can use it
    db.prepare(`UPDATE tabs SET status = 'idle', pid = NULL WHERE id = ?`).run(row.id);

    // Resume the session
    tabManager.sendMessage(row.name, recoveryPrompt, { resume: true }).catch(err => {
      logger.error(`Failed to recover tab ${row.name}:`, err);
    });

    // Notify via Telegram
    if (telegramBot) {
      await telegramBot.sendNotification(
        `Beecork restarted. Recovered tab "${row.name}" — session resumed.`
      );
    }
  }
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
