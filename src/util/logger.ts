import fs from 'node:fs';
import path from 'node:path';
import { getLogsDir } from './paths.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private minLevel: LogLevel = 'info';
  private logFile: string | null = null;
  private stream: fs.WriteStream | null = null;

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  setLogFile(name: string): void {
    const dir = getLogsDir();
    fs.mkdirSync(dir, { recursive: true });
    this.logFile = path.join(dir, name);
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
  }

  private write(level: LogLevel, msg: string, ...args: unknown[]): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    const line = args.length > 0
      ? `${prefix} ${msg} ${args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`
      : `${prefix} ${msg}`;

    if (this.stream) {
      this.stream.write(line + '\n');
    }

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else if (level !== 'debug') {
      console.log(line);
    }
  }

  debug(msg: string, ...args: unknown[]): void { this.write('debug', msg, ...args); }
  info(msg: string, ...args: unknown[]): void { this.write('info', msg, ...args); }
  warn(msg: string, ...args: unknown[]): void { this.write('warn', msg, ...args); }
  error(msg: string, ...args: unknown[]): void { this.write('error', msg, ...args); }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

export const logger = new Logger();
