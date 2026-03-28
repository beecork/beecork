import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const BEECORK_DIR = '.beecork';

export function getBeecorkHome(): string {
  return path.join(os.homedir(), BEECORK_DIR);
}

export function getConfigPath(): string {
  return path.join(getBeecorkHome(), 'config.json');
}

export function getDbPath(): string {
  return path.join(getBeecorkHome(), 'memory.db');
}

export function getCrontabPath(): string {
  return path.join(getBeecorkHome(), 'crontab.json');
}

export function getMcpConfigPath(): string {
  return path.join(getBeecorkHome(), 'mcp-config.json');
}

export function getLogsDir(): string {
  return path.join(getBeecorkHome(), 'logs');
}

export function getPidPath(): string {
  return path.join(getBeecorkHome(), 'beecork.pid');
}

export function getCronReloadSignalPath(): string {
  return path.join(getBeecorkHome(), '.cron-reload');
}

export function ensureBeecorkDirs(): void {
  const home = getBeecorkHome();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(getLogsDir(), { recursive: true });
}

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}
