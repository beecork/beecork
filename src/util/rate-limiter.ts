import { logger } from './logger.js';

interface Window {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private global: Window = { count: 0, resetAt: Date.now() + 60000 };
  private perKey = new Map<string, Window>();

  constructor(
    private globalLimit: number = 20,
    private perKeyLimit: number = 10,
    private windowMs: number = 60000,
  ) {}

  /** Returns true if the request is allowed */
  check(key: string): boolean {
    const now = Date.now();

    // Reset global window
    if (now > this.global.resetAt) {
      this.global = { count: 0, resetAt: now + this.windowMs };
    }
    if (this.global.count >= this.globalLimit) {
      logger.warn(`Rate limit: global limit reached (${this.globalLimit}/min)`);
      return false;
    }

    // Reset per-key window
    let keyWindow = this.perKey.get(key);
    if (!keyWindow || now > keyWindow.resetAt) {
      keyWindow = { count: 0, resetAt: now + this.windowMs };
      this.perKey.set(key, keyWindow);
    }
    if (keyWindow.count >= this.perKeyLimit) {
      logger.warn(`Rate limit: channel ${key} limit reached (${this.perKeyLimit}/min)`);
      return false;
    }

    this.global.count++;
    keyWindow.count++;
    return true;
  }
}

/** Shared singleton rate limiter for inbound messages */
export const inboundLimiter = new RateLimiter(60, 30);
