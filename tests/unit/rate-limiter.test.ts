import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { RateLimiter, inboundLimiter, groupLimiter } from '../../src/util/rate-limiter.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests under global limit', () => {
    const limiter = new RateLimiter(5, 10);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    expect(limiter.check('c')).toBe(true);
  });

  it('should block requests at global limit', () => {
    const limiter = new RateLimiter(2, 10);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    expect(limiter.check('c')).toBe(false); // global limit hit
  });

  it('should allow requests under per-key limit', () => {
    const limiter = new RateLimiter(100, 3);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
  });

  it('should block requests at per-key limit for specific key', () => {
    const limiter = new RateLimiter(100, 2);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false); // per-key limit hit
    expect(limiter.check('b')).toBe(true);  // different key still allowed
  });

  it('should reset global window after windowMs', () => {
    // Note: the class initializes global.resetAt with Date.now() + 60000 (hardcoded),
    // but after first reset it uses the configured windowMs.
    // So we first exhaust the initial 60s window, then test with the custom windowMs.
    const limiter = new RateLimiter(1, 10, 5000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(false); // blocked

    vi.advanceTimersByTime(60001); // pass the initial hardcoded 60s window

    expect(limiter.check('c')).toBe(true); // global reset, allowed
    expect(limiter.check('d')).toBe(false); // blocked again

    vi.advanceTimersByTime(5001); // now uses configured windowMs

    expect(limiter.check('e')).toBe(true); // reset again
  });

  it('should reset per-key window after windowMs', () => {
    const limiter = new RateLimiter(100, 1, 5000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false); // blocked

    vi.advanceTimersByTime(5001);

    expect(limiter.check('a')).toBe(true); // reset
  });

  it('should track keys independently', () => {
    const limiter = new RateLimiter(100, 1);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    expect(limiter.check('a')).toBe(false); // key 'a' exhausted
    expect(limiter.check('b')).toBe(false); // key 'b' exhausted
    expect(limiter.check('c')).toBe(true);  // key 'c' fresh
  });

  it('should respect custom constructor parameters', () => {
    const limiter = new RateLimiter(1, 1, 1000);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
  });

  it('should export singleton inboundLimiter', () => {
    expect(inboundLimiter).toBeInstanceOf(RateLimiter);
  });

  it('should export singleton groupLimiter', () => {
    expect(groupLimiter).toBeInstanceOf(RateLimiter);
  });
});
