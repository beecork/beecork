import type { CircuitBreakerConfig, StreamContentToolUse } from '../types.js';
import { logger } from '../util/logger.js';

export type CircuitBreakerAction = 'ok' | 'warn' | 'notify' | 'break';

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxRepeats: 20,
  windowSize: 30,
};

export class CircuitBreaker {
  private recentCalls: string[] = [];
  private config: CircuitBreakerConfig;
  private tripped = false;
  private warnedAt = 0;
  private notifiedAt = 0;

  private readonly WARN_THRESHOLD = 5;
  private readonly NOTIFY_THRESHOLD = 10;

  constructor(private tabName: string, config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a tool call. Returns the action to take. */
  recordToolCall(toolUse: StreamContentToolUse): CircuitBreakerAction {
    if (this.tripped) return 'break';

    const signature = `${toolUse.name}:${JSON.stringify(toolUse.input)}`;
    this.recentCalls.push(signature);

    // Keep only the last windowSize calls
    if (this.recentCalls.length > this.config.windowSize) {
      this.recentCalls = this.recentCalls.slice(-this.config.windowSize);
    }

    // Count consecutive identical calls from the end
    const lastCall = this.recentCalls[this.recentCalls.length - 1];
    let repeatCount = 0;
    for (let i = this.recentCalls.length - 1; i >= 0; i--) {
      if (this.recentCalls[i] === lastCall) {
        repeatCount++;
      } else {
        break;
      }
    }

    if (repeatCount >= this.config.maxRepeats) {
      logger.warn(`[${this.tabName}] Circuit breaker tripped: ${toolUse.name} repeated ${repeatCount} times`);
      this.tripped = true;
      return 'break';
    }

    if (repeatCount >= this.NOTIFY_THRESHOLD && this.notifiedAt < this.NOTIFY_THRESHOLD) {
      logger.warn(`[${this.tabName}] Loop detected: ${toolUse.name} repeated ${repeatCount} times — notifying user`);
      this.notifiedAt = repeatCount;
      return 'notify';
    }

    if (repeatCount >= this.WARN_THRESHOLD && this.warnedAt < this.WARN_THRESHOLD) {
      logger.info(`[${this.tabName}] Loop detected: ${toolUse.name} repeated ${repeatCount} times — warning`);
      this.warnedAt = repeatCount;
      return 'warn';
    }

    return 'ok';
  }

  reset(): void {
    this.recentCalls = [];
    this.tripped = false;
    this.warnedAt = 0;
    this.notifiedAt = 0;
  }

  get isTripped(): boolean {
    return this.tripped;
  }
}
