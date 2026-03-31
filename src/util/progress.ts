import { logger } from './logger.js';

/**
 * Collects tool use events and sends batched progress updates
 * with escalating intervals and next-update predictions.
 *
 * Schedule: 15s → 30s → 1m → 2m → 3m → 4m → ... (grows by 1m after 2m)
 * Each update tells the user when the next one will come.
 * Works across all channels (Telegram, Discord, WhatsApp, etc.)
 */
export class ProgressTracker {
  private events: Array<{ tool: string; summary: string }> = [];
  private startTime: number;
  private onReport: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private tabName: string;
  private reportCount = 0;

  // Escalating intervals in ms: 15s, 30s, 1m, 2m, then +1m each
  private readonly intervals = [15000, 30000, 60000, 120000];

  constructor(tabName: string, onReport: (message: string) => void) {
    this.tabName = tabName;
    this.startTime = Date.now();
    this.onReport = onReport;
    this.scheduleNext();
  }

  /** Record a tool use event */
  record(toolName: string, toolInput: Record<string, unknown>): void {
    this.events.push({ tool: toolName, summary: this.summarizeTool(toolName, toolInput) });
  }

  /** Stop the timer (called when task finishes) */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Get the interval for the current report number */
  private getInterval(): number {
    if (this.reportCount < this.intervals.length) {
      return this.intervals[this.reportCount];
    }
    // After the fixed intervals, grow by 1 minute each time (3m, 4m, 5m, ...)
    const extraMinutes = this.reportCount - this.intervals.length + 3;
    return extraMinutes * 60000;
  }

  /** Format a duration in ms to a human-readable string */
  private formatDuration(ms: number): string {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  /** Schedule the next progress report */
  private scheduleNext(): void {
    const interval = this.getInterval();
    this.timer = setTimeout(() => {
      this.flush();
      this.reportCount++;
      this.scheduleNext();
    }, interval);
  }

  /** Flush pending events as a progress report */
  private flush(): void {
    if (this.events.length === 0) return;

    const elapsed = Date.now() - this.startTime;
    const elapsedStr = this.formatDuration(elapsed);

    // Build the activity summary
    const lines: string[] = [];
    for (const event of this.events) {
      lines.push(`  ${event.summary}`);
    }
    this.events = [];

    // Calculate when the next update will come
    const nextInterval = this.getInterval();
    const nextStr = this.formatDuration(nextInterval);

    const message = [
      `\uD83D\uDD04 Working on "${this.tabName}" (${elapsedStr} elapsed)`,
      ...lines,
      `\n\u23F3 Next update in ${nextStr} or when finished.`,
    ].join('\n');

    try {
      this.onReport(message);
    } catch (err) {
      logger.warn('Progress report failed:', err);
    }
  }

  /** Summarize a tool call into a human-readable one-liner */
  private summarizeTool(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case 'Write':
      case 'write':
        return `\uD83D\uDCDD Created ${this.extractPath(input)}`;
      case 'Edit':
      case 'edit':
        return `\uD83D\uDCDD Edited ${this.extractPath(input)}`;
      case 'Read':
      case 'read':
        return `\uD83D\uDC41 Read ${this.extractPath(input)}`;
      case 'Bash':
      case 'bash':
        return `\uD83D\uDD27 Ran: ${this.extractCommand(input)}`;
      case 'Glob':
      case 'glob':
        return `\uD83D\uDD0D Searched for files: ${input.pattern || '...'}`;
      case 'Grep':
      case 'grep':
        return `\uD83D\uDD0D Searched code: ${input.pattern || '...'}`;
      case 'WebSearch':
      case 'web_search':
        return `\uD83C\uDF10 Searched: ${input.query || '...'}`;
      case 'WebFetch':
      case 'web_fetch':
        return `\uD83C\uDF10 Fetched: ${input.url || '...'}`;
      default:
        return `\u2699\uFE0F ${name}`;
    }
  }

  private extractPath(input: Record<string, unknown>): string {
    const p = (input.file_path || input.path || input.filePath || '') as string;
    if (p.includes('/')) return p.split('/').pop() || p;
    if (p.includes('\\')) return p.split('\\').pop() || p;
    return p || '...';
  }

  private extractCommand(input: Record<string, unknown>): string {
    const cmd = (input.command || input.cmd || '') as string;
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd || '...';
  }
}
