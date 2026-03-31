import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { logger } from '../util/logger.js';

const TASK_NAME = 'BeecorkDaemon';

/** Install Beecork as a Windows Task Scheduler task */
export function installWindowsService(binPath: string): void {
  const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  const logPath = path.join(appData, '.beecork', 'logs', 'daemon.log');

  // Ensure log directory exists
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  // Create a wrapper script that runs beecork daemon
  const wrapperPath = path.join(appData, '.beecork', 'start-daemon.bat');
  fs.writeFileSync(wrapperPath, `@echo off\r\n"${binPath}" daemon >> "${logPath}" 2>&1\r\n`);

  try {
    // Remove existing task if any
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F 2>nul`, { stdio: 'ignore' });
  } catch {}

  // Create scheduled task that runs at logon
  execSync(`schtasks /Create /TN "${TASK_NAME}" /TR "${wrapperPath}" /SC ONLOGON /RL HIGHEST /F`, {
    stdio: 'inherit',
  });

  console.log(`Windows service installed: ${TASK_NAME}`);
  console.log('The daemon will start automatically when you log in.');
}

/** Start the Windows service */
export function startWindowsService(): void {
  try {
    execSync(`schtasks /Run /TN "${TASK_NAME}"`, { stdio: 'inherit' });
    console.log('Beecork daemon started.');
  } catch (err) {
    console.error('Failed to start. Run manually: beecork daemon');
  }
}

/** Stop the Windows service */
export function stopWindowsService(): void {
  try {
    execSync(`schtasks /End /TN "${TASK_NAME}"`, { stdio: 'inherit' });
    console.log('Beecork daemon stopped.');
  } catch {
    // Try killing the process directly
    try {
      execSync('taskkill /F /IM node.exe /FI "WINDOWTITLE eq beecork*"', { stdio: 'ignore' });
    } catch {}
  }
}

/** Uninstall the Windows service */
export function uninstallWindowsService(): void {
  try {
    execSync(`schtasks /Delete /TN "${TASK_NAME}" /F`, { stdio: 'inherit' });
    console.log('Beecork service uninstalled.');
  } catch {
    console.error('Failed to uninstall service.');
  }
}

/** Check if the Windows service is installed */
export function isWindowsServiceInstalled(): boolean {
  try {
    execSync(`schtasks /Query /TN "${TASK_NAME}" 2>nul`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
