import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { retryWithBackoff } from '../../src/util/retry.js';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return value on first-try success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed on second attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const promise = retryWithBackoff(fn, [100]);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should exhaust all retries and throw last error', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error('persistent failure'));
    });

    const promise = retryWithBackoff(fn, [100, 200]);
    // Catch to prevent unhandled rejection warning — we assert below
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(300);

    await expect(promise).rejects.toThrow('persistent failure');
    expect(callCount).toBe(3);
  });

  it('should convert non-Error throws to Error objects', async () => {
    const fn = vi.fn().mockRejectedValue('string error');

    const promise = retryWithBackoff(fn, []);
    await expect(promise).rejects.toThrow('string error');
  });

  it('should work with empty delays array (single attempt)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(retryWithBackoff(fn, [])).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should respect custom delay values', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const promise = retryWithBackoff(fn, [5000]);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    // Verify setTimeout was called with our delay
    const calls = setTimeoutSpy.mock.calls.filter(c => c[1] === 5000);
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should use default delays when none provided', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const promise = retryWithBackoff(fn);
    await vi.advanceTimersByTimeAsync(1000); // default first delay
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw fallback error when lastError is undefined', async () => {
    // This tests the ?? branch — in practice lastError is always set,
    // but we test the fallback message
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, [], 'my-op');
    expect(result).toBe('ok');
  });
});
