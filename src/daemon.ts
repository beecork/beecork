import fs from 'node:fs';
import { getConfig } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { TabManager } from './session/manager.js';
import { ChannelRegistry, TelegramChannel, WhatsAppChannel } from './channels/index.js';
import { CronScheduler } from './cron/scheduler.js';
import { PipeBrain } from './pipe/brain.js';
import { ensureBeecorkDirs, getPidPath, getBeecorkHome } from './util/paths.js';
import { execSync } from 'node:child_process';
import { logger } from './util/logger.js';
import { VERSION } from './version.js';

let tabManager: TabManager;
let channelRegistry: ChannelRegistry;
let cronScheduler: CronScheduler;
let pipeBrain: PipeBrain | null = null;
let pollInterval: ReturnType<typeof setInterval>;
let shutdownFn: (() => Promise<void>) | null = null;

/** Broadcast notifications to all active channels */
async function broadcastNotify(text: string): Promise<void> {
  await channelRegistry.broadcastNotify(text);
}

async function main(): Promise<void> {
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

  // 3. Write PID file with exclusive lock to prevent race condition
  try {
    const fd = fs.openSync(pidPath, 'wx'); // Fails if file already exists (atomic create)
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
  } catch {
    // File was just created by another instance between our check and write — fallback to overwrite
    // (the PID check above should have caught live processes)
    fs.writeFileSync(pidPath, String(process.pid));
  }
  logger.info(`PID file written: ${process.pid}`);

  // 4. Create TabManager
  tabManager = new TabManager(config);

  // 5. Initialize pipe brain (if API key configured)
  if (config.pipe?.enabled && config.pipe?.anthropicApiKey) {
    pipeBrain = new PipeBrain(config, tabManager);
    const projectCount = await pipeBrain.discoverProjects();
    logger.info(`Pipe brain initialized — ${projectCount} projects discovered`);
  }

  // 6. Ensure default tab
  tabManager.ensureTab('default');

  // 7. Recover crashed tabs
  await recoverCrashedTabs();

  // Start channels via registry
  channelRegistry = new ChannelRegistry();
  const channelCtx = { config, tabManager, pipeBrain };

  if (config.telegram?.token) {
    channelRegistry.register(new TelegramChannel(channelCtx));
  } else {
    logger.warn('No Telegram token configured. Bot not started.');
  }

  if (config.whatsapp?.enabled) {
    channelRegistry.register(new WhatsAppChannel(channelCtx));
  }

  await channelRegistry.start();

  // Wire up broadcast notifications to all active channels
  tabManager.setNotifyCallback(broadcastNotify);
  if (pipeBrain) {
    pipeBrain.setNotifyCallback(broadcastNotify);
  }

  // 9. Start cron scheduler
  cronScheduler = new CronScheduler(tabManager, broadcastNotify);
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
    try { await broadcastNotify('🔴 Beecork stopping'); } catch { /* ok */ }

    clearInterval(pollInterval);
    tabManager.stopAll();
    channelRegistry.stop();
    cronScheduler.stopAll();
    closeDb();

    const pidPath = getPidPath();
    if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);

    logger.info('Beecork daemon stopped.');
    logger.close();
    process.exit(0);
  };

  shutdownFn = shutdown;
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Resilience: catch unhandled errors to prevent silent daemon death
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
    // Log and continue — don't crash the daemon for a stray promise
  });
  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception — shutting down gracefully:', err);
    if (shutdownFn) await shutdownFn();
    process.exit(1);
  });

  logger.info(`Beecork daemon ready (home: ${getBeecorkHome()})`);

  // Send detailed startup notification (non-critical — don't crash if it fails)
  try {
    const tabs = tabManager.listTabs();
    const cronJobs = new (await import('./cron/store.js')).CronStore().list().filter(j => j.enabled);
    await broadcastNotify(
      `🟢 Beecork started — ${cronJobs.length} cron job${cronJobs.length !== 1 ? 's' : ''}, ${tabs.length} tab${tabs.length !== 1 ? 's' : ''}`
    );
  } catch (err) {
    logger.warn('Failed to send startup notification:', err);
  }

  // Check for updates (fire and forget — non-critical)
  try {
    const latest = execSync('npm view beecork version', { encoding: 'utf-8' }).trim();
    if (latest && latest !== VERSION) {
      await broadcastNotify(`📦 Update available: v${VERSION} → v${latest}\nRun: beecork update`);
      logger.info(`Update available: v${VERSION} → v${latest}`);
    }
  } catch { /* offline or npm registry unreachable — skip silently */ }
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

    // Notify via all channels
    await broadcastNotify(
      `Beecork restarted. Recovered tab "${row.name}" — session resumed.`
    ).catch(() => {});
  }
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
