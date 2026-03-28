import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../util/logger.js';
import { getMcpConfigPath } from '../util/paths.js';
import type { BeecorkConfig, StreamEvent } from '../types.js';

const BEECORK_SYSTEM_PROMPT = `You are running inside Beecork, an always-on infrastructure for Claude Code.

You have these special MCP tools available:
- beecork_remember: Store important facts for future sessions (preferences, server addresses, decisions, outcomes)
- beecork_recall: Search stored memories — ALWAYS call this at the start of complex tasks
- beecork_cron_create: Schedule recurring tasks (types: "at" for one-time, "every" for interval like "30m", "cron" for expressions like "0 9 * * 1")
- beecork_cron_list: List scheduled tasks
- beecork_cron_delete: Remove a scheduled task
- beecork_tab_create: Create a new virtual tab for parallel work
- beecork_tab_list: List all tabs
- beecork_send_message: Send a message to another tab
- beecork_notify: Send the user a notification mid-task without stopping
- beecork_status: Check system status

Guidelines:
- You are running unattended. Be thorough and complete tasks fully.
- Always call beecork_recall at the start of any task to check relevant memories.
- Always call beecork_remember when you learn something important.
- When asked for recurring tasks, use beecork_cron_create.
- Use beecork_notify for progress updates during long tasks.`;

export interface SubprocessCallbacks {
  onEvent: (event: StreamEvent) => void;
  onExit: (code: number | null) => void;
  onError: (err: Error) => void;
}

export class ClaudeSubprocess {
  private proc: ChildProcess | null = null;
  private buffer: string = '';
  readonly sessionId: string;

  constructor(
    private tabName: string,
    private workingDir: string,
    private config: BeecorkConfig,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? uuidv4();
  }

  async send(prompt: string, callbacks: SubprocessCallbacks, resume: boolean = false): Promise<void> {
    if (this.proc) {
      throw new Error(`Subprocess for tab "${this.tabName}" is already running`);
    }

    const args = this.buildArgs(prompt, resume);

    logger.debug(`[${this.tabName}] Spawning: ${this.config.claudeCode.bin} ${args.join(' ')}`);

    this.proc = spawn(this.config.claudeCode.bin, args, {
      cwd: this.workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const pid = this.proc.pid;
    logger.info(`[${this.tabName}] Claude subprocess started (PID: ${pid})`);

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event: StreamEvent = JSON.parse(line);
          callbacks.onEvent(event);
        } catch {
          // Non-JSON line (verbose debug output), skip
          logger.debug(`[${this.tabName}] non-json: ${line.slice(0, 200)}`);
        }
      }
    });

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.debug(`[${this.tabName}] stderr: ${text.slice(0, 500)}`);
      }
    });

    this.proc.on('error', (err) => {
      this.proc = null;
      callbacks.onError(err);
    });

    this.proc.on('exit', (code) => {
      this.proc = null;
      logger.info(`[${this.tabName}] Claude subprocess exited (code: ${code})`);
      callbacks.onExit(code);
    });
  }

  /** Wait for the subprocess to finish. Returns the exit code. */
  waitForExit(): Promise<number | null> {
    return new Promise((resolve) => {
      if (!this.proc) {
        resolve(null);
        return;
      }
      this.proc.on('exit', (code) => resolve(code));
    });
  }

  kill(): void {
    if (!this.proc) return;
    logger.info(`[${this.tabName}] Killing subprocess (PID: ${this.proc.pid})`);
    this.proc.kill('SIGTERM');
    const proc = this.proc;
    setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, 5000);
  }

  get isRunning(): boolean {
    return this.proc !== null;
  }

  get pid(): number | null {
    return this.proc?.pid ?? null;
  }

  private buildArgs(prompt: string, resume: boolean): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      ...this.config.claudeCode.defaultFlags,
    ];

    // Only add MCP config if the file exists
    const mcpConfig = getMcpConfigPath();
    if (fs.existsSync(mcpConfig)) {
      args.push('--mcp-config', mcpConfig);
    }

    // Inject Beecork system context so Claude knows about available tools
    if (!resume) {
      args.push('--system-prompt', BEECORK_SYSTEM_PROMPT);
    }

    if (resume) {
      args.push('--resume', this.sessionId);
    } else {
      args.push('--session-id', this.sessionId);
    }

    if (this.config.claudeCode.maxBudgetUsd) {
      args.push('--max-budget-usd', String(this.config.claudeCode.maxBudgetUsd));
    }

    args.push(prompt);

    return args;
  }
}
