import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { getDb, closeDb } from '../db/index.js';
import { getConfig } from '../config.js';
import { TaskStore } from '../tasks/store.js';
import { getDaemonPid, timeAgo } from './helpers.js';
import { startService, stopService } from '../service/install.js';
import { getPidPath, getLogsDir } from '../util/paths.js';
import { VERSION } from '../version.js';
import type { Memory } from '../types.js';
import type Database from 'better-sqlite3';

function requireDb(): Database.Database {
  try {
    return getDb();
  } catch {
    console.error('Database not initialized — run "beecork setup" first.');
    process.exit(1);
  }
}

// Map snake_case DB rows to display format
interface TabRow {
  id: string; name: string; session_id: string; status: string;
  working_dir: string; created_at: string; last_activity_at: string; pid: number | null;
}

export async function startDaemon(): Promise<void> {
  const existingPid = getDaemonPid();
  if (existingPid) {
    console.log(`Beecork daemon is already running (PID: ${existingPid})`);
    return;
  }

  // Check if WhatsApp needs pairing
  const config = getConfig();
  const waSessionPath = config.whatsapp?.sessionPath ?? `${process.env.HOME}/.beecork/whatsapp-session`;
  const waEnabled = config.whatsapp?.enabled;
  const waHasSession = waEnabled && fs.existsSync(waSessionPath) && fs.readdirSync(waSessionPath).length > 0;

  if (waEnabled && !waHasSession) {
    console.log('\n⚠ WhatsApp is enabled but not yet paired.');
    console.log('  Starting daemon in foreground so you can scan the QR code...');
    console.log('  Once paired, press Ctrl+C and run "beecork start" again.\n');
    const daemonPath = new URL('../daemon.js', import.meta.url).pathname;
    const child = spawn('node', [daemonPath], {
      stdio: 'inherit',
    });
    process.on('SIGINT', () => { child.kill(); process.exit(0); });
    return;
  }

  try {
    startService();
    console.log('Beecork daemon started via system service.');
  } catch {
    // Fallback: start daemon directly
    console.log('Starting daemon directly...');
    const daemonPath = new URL('../daemon.js', import.meta.url).pathname;
    const child = spawn('node', [daemonPath], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`Beecork daemon started (PID: ${child.pid})`);
  }
}

export async function stopDaemon(): Promise<void> {
  const pid = getDaemonPid();
  if (!pid) {
    console.log('Beecork daemon is not running.');
    return;
  }

  try {
    stopService();
  } catch {
    // Fallback: kill by PID
    try {
      process.kill(pid, 'SIGTERM');
      const pidPath = getPidPath();
      if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
    } catch (killErr) {
      const msg = killErr instanceof Error ? killErr.message : String(killErr);
      console.error(`Failed to stop daemon (PID ${pid}): ${msg}`);
      return;
    }
  }

  console.log('Beecork daemon stopped.');
}

export async function showStatus(): Promise<void> {
  const pid = getDaemonPid();
  const config = getConfig();

  console.log(`\nBeecork v${VERSION}`);
  console.log(`Daemon: ${pid ? `running (PID ${pid})` : 'stopped'}`);
  console.log(`Deployment: ${config.deployment}`);

  try {
    const db = getDb();
    const tabs = db.prepare('SELECT * FROM tabs ORDER BY last_activity_at DESC').all() as TabRow[];

    console.log(`\nTabs (${tabs.length}):`);
    for (const tab of tabs) {
      const ago = timeAgo(tab.last_activity_at);
      const pidInfo = tab.pid ? ` (PID ${tab.pid})` : '';
      console.log(`  ${tab.name.padEnd(20)} ${tab.status.padEnd(12)} last active: ${ago}${pidInfo}`);
    }

    const store = new TaskStore();
    const jobs = store.list();
    const activeJobs = jobs.filter(j => j.enabled);
    console.log(`\nTasks: ${activeJobs.length} active (${jobs.length} total)`);

    if (activeJobs.length > 0) {
      for (const job of activeJobs.slice(0, 5)) {
        const lastRun = job.lastRunAt ? `last: ${timeAgo(job.lastRunAt)}` : 'never run';
        console.log(`  ${job.name.padEnd(20)} ${job.scheduleType}:${job.schedule.padEnd(15)} → tab:${job.tabName} (${lastRun})`);
      }
    }

    closeDb();
  } catch {
    console.log('\n(database not initialized — run "beecork setup" first)');
  }

  console.log('');
}

export async function listTabs(): Promise<void> {
  const db = requireDb();
  const tabs = db.prepare('SELECT * FROM tabs ORDER BY last_activity_at DESC').all() as TabRow[];
  closeDb();

  if (tabs.length === 0) {
    console.log('No tabs.');
    return;
  }

  console.log(`\nTabs (${tabs.length}):\n`);
  for (const tab of tabs) {
    const ago = timeAgo(tab.last_activity_at);
    console.log(`  ${tab.name.padEnd(20)} [${tab.status}] dir:${tab.working_dir} — ${ago}`);
  }
  console.log('');
}

export async function tailLogs(tabName?: string): Promise<void> {
  const logFile = tabName
    ? `${getLogsDir()}/${path.basename(tabName)}.log`
    : `${getLogsDir()}/daemon.stdout.log`;

  if (!fs.existsSync(logFile)) {
    console.log(`No log file found: ${logFile}`);
    return;
  }

  if (process.platform === 'win32') {
    // Windows: use PowerShell Get-Content -Wait
    const child = spawn('powershell', ['-Command', `Get-Content -Path '${logFile}' -Tail 50 -Wait`], { stdio: 'inherit' });
    process.on('SIGINT', () => child.kill());
  } else {
    const child = spawn('tail', ['-f', '-n', '50', logFile], { stdio: 'inherit' });
    process.on('SIGINT', () => child.kill());
  }
}

export async function listCrons(): Promise<void> {
  requireDb();
  const store = new TaskStore();
  const jobs = store.list();

  if (jobs.length === 0) {
    console.log('No tasks.');
    return;
  }

  console.log(`\nTasks (${jobs.length}):\n`);
  for (const job of jobs) {
    const status = job.enabled ? 'enabled' : 'disabled';
    const lastRun = job.lastRunAt ? timeAgo(job.lastRunAt) : 'never';
    console.log(`  ${job.name.padEnd(20)} [${status}] ${job.scheduleType}:${job.schedule}`);
    console.log(`    -> tab:${job.tabName} | last: ${lastRun} | ID: ${job.id}`);
  }
  console.log('');
}

export async function deleteCron(id: string): Promise<void> {
  requireDb();
  const store = new TaskStore();
  if (store.delete(id)) {
    console.log(`Deleted task: ${id}`);
  } else {
    console.log(`No task found with ID: ${id}`);
  }
}

export async function listWatchers(): Promise<void> {
  const db = requireDb();
  const watchers = db.prepare('SELECT * FROM watchers ORDER BY created_at').all() as Array<Record<string, unknown>>;
  closeDb();

  if (watchers.length === 0) {
    console.log('No watchers.');
    return;
  }

  console.log(`\nWatchers (${watchers.length}):\n`);
  for (const w of watchers) {
    const status = w.enabled ? 'enabled' : 'disabled';
    const lastCheck = w.last_check_at ? timeAgo(w.last_check_at as string) : 'never';
    console.log(`  ${(w.name as string).padEnd(20)} [${status}] ${w.schedule}`);
    console.log(`    condition: ${w.condition} | action: ${w.action} | triggers: ${w.trigger_count} | last: ${lastCheck} | ID: ${w.id}`);
  }
  console.log('');
}

export async function deleteWatcher(id: string): Promise<void> {
  const db = requireDb();
  const result = db.prepare('DELETE FROM watchers WHERE id = ?').run(id);
  closeDb();

  if (result.changes > 0) {
    console.log(`Deleted watcher: ${id}`);
  } else {
    console.log(`No watcher found with ID: ${id}`);
  }
}

export async function listMemories(): Promise<void> {
  const db = requireDb();
  const memories = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 50').all() as Memory[];
  closeDb();

  if (memories.length === 0) {
    console.log('No memories stored.');
    return;
  }

  console.log(`\nMemories (${memories.length}):\n`);
  for (const mem of memories) {
    const scope = mem.tabName ? `tab:${mem.tabName}` : 'global';
    console.log(`  [${mem.id}] (${mem.source}, ${scope}) ${mem.content.slice(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
    console.log(`       ${timeAgo(mem.createdAt)}`);
  }
  console.log('');
}

export async function deleteMemory(id: string): Promise<void> {
  const db = requireDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(parseInt(id, 10));
  closeDb();

  if (result.changes > 0) {
    console.log(`Deleted memory: ${id}`);
  } else {
    console.log(`No memory found with ID: ${id}`);
  }
}

export async function updateBeecork(options: { check?: boolean }): Promise<void> {
  if (options.check) {
    try {
      const latest = execSync('npm view beecork version', { encoding: 'utf-8' }).trim();
      const current = VERSION;
      if (latest === current) {
        console.log(`Already up to date (v${current})`);
      } else {
        console.log(`Update available: v${current} → v${latest}`);
        console.log('Run `beecork update` to install.');
      }
    } catch {
      console.log('Could not check for updates.');
    }
    return;
  }

  // Stop daemon if running
  const pid = getDaemonPid();
  if (pid) {
    console.log('Stopping daemon before update...');
    await stopDaemon();
  }

  console.log('Updating beecork...');
  try {
    execSync('npm install -g beecork@latest', { stdio: 'inherit' });
    console.log('Update complete!');
  } catch {
    console.error('Update failed. Try running: npm install -g beecork@latest');
  }

  // Restart if it was running
  if (pid) {
    console.log('Restarting daemon...');
    await startDaemon();
  }
}

export async function sendMessage(message: string): Promise<void> {
  // This is a simple CLI test command. It starts a subprocess directly.
  const { TabManager } = await import('../session/manager.js');
  const config = getConfig();
  const manager = new TabManager(config);

  console.log(`Sending to default tab: "${message}"\n`);

  try {
    const result = await manager.sendMessage('default', message);
    console.log(result.text);
    if (result.costUsd > 0) {
      console.log(`\n--- Cost: $${result.costUsd.toFixed(4)} | Duration: ${result.durationMs}ms ---`);
    }
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : err);
  }

  closeDb();
}
