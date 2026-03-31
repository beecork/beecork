import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { getPlatform } from '../util/platform.js';
import { ensureBeecorkDirs } from '../util/paths.js';
import {
  getLaunchdPlist,
  getSystemdUnit,
  getLaunchdPlistPath,
  getSystemdUnitPath,
} from './templates.js';
import {
  installWindowsService,
  startWindowsService,
  stopWindowsService,
  uninstallWindowsService,
} from './windows.js';

function findNodePath(): string {
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split(/\r?\n/)[0];
  } catch {
    return process.platform === 'win32' ? 'node' : '/usr/local/bin/node';
  }
}

function findDaemonPath(): string {
  // import.meta.url is dist/service/install.js — daemon is at dist/daemon.js (one level up)
  const thisFileUrl = new URL(import.meta.url);
  const thisFile = process.platform === 'win32'
    ? thisFileUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1') // strip leading / on Windows drive paths
    : thisFileUrl.pathname;
  const distDir = path.dirname(path.dirname(thisFile)); // go up from service/ to dist/
  const daemonPath = path.join(distDir, 'daemon.js');
  if (fs.existsSync(daemonPath)) return daemonPath;

  // Fallback: maybe we're in src/ during development
  const srcDaemon = path.resolve(distDir, '..', 'dist', 'daemon.js');
  if (fs.existsSync(srcDaemon)) return srcDaemon;

  throw new Error('Could not find daemon.js. Make sure beecork is built (npm run build).');
}

export function installService(): string {
  ensureBeecorkDirs();
  const platform = getPlatform();
  const nodePath = findNodePath();
  const daemonPath = findDaemonPath();

  if (platform === 'windows') {
    installWindowsService(`${nodePath}" "${daemonPath}`);
    return 'Windows Task Scheduler';
  } else if (platform === 'mac') {
    return installLaunchd(nodePath, daemonPath);
  } else {
    return installSystemd(nodePath, daemonPath);
  }
}

export function uninstallService(): string {
  const platform = getPlatform();
  if (platform === 'windows') {
    uninstallWindowsService();
    return 'Windows Task Scheduler';
  } else if (platform === 'mac') {
    return uninstallLaunchd();
  } else {
    return uninstallSystemd();
  }
}

export function startService(): void {
  const platform = getPlatform();
  if (platform === 'windows') {
    startWindowsService();
  } else if (platform === 'mac') {
    const plistPath = getLaunchdPlistPath();
    execSync(`launchctl load "${plistPath}"`, { stdio: 'inherit' });
  } else {
    execSync('systemctl --user start beecork', { stdio: 'inherit' });
  }
}

export function stopService(): void {
  const platform = getPlatform();
  if (platform === 'windows') {
    stopWindowsService();
  } else if (platform === 'mac') {
    const plistPath = getLaunchdPlistPath();
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'inherit' });
    } catch { /* not loaded */ }
  } else {
    try {
      execSync('systemctl --user stop beecork', { stdio: 'inherit' });
    } catch { /* not running */ }
  }
}

function installLaunchd(nodePath: string, daemonPath: string): string {
  const plistPath = getLaunchdPlistPath();
  const plistDir = path.dirname(plistPath);
  fs.mkdirSync(plistDir, { recursive: true });

  const content = getLaunchdPlist(nodePath, daemonPath);
  fs.writeFileSync(plistPath, content);

  return plistPath;
}

function uninstallLaunchd(): string {
  const plistPath = getLaunchdPlistPath();
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: 'pipe' }); } catch { /* ok */ }
  if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
  return plistPath;
}

function installSystemd(nodePath: string, daemonPath: string): string {
  const unitPath = getSystemdUnitPath();
  const unitDir = path.dirname(unitPath);
  fs.mkdirSync(unitDir, { recursive: true });

  const content = getSystemdUnit(nodePath, daemonPath);
  fs.writeFileSync(unitPath, content);

  execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
  execSync('systemctl --user enable beecork', { stdio: 'pipe' });

  return unitPath;
}

function uninstallSystemd(): string {
  const unitPath = getSystemdUnitPath();
  try { execSync('systemctl --user disable beecork', { stdio: 'pipe' }); } catch { /* ok */ }
  try { execSync('systemctl --user stop beecork', { stdio: 'pipe' }); } catch { /* ok */ }
  if (fs.existsSync(unitPath)) fs.unlinkSync(unitPath);
  execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
  return unitPath;
}
