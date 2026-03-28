import { describe, it, expect, beforeEach } from 'vitest';
import { ContextMonitor } from '../../src/session/context-monitor.js';
import { makeUsage } from '../fixtures/mock-config.js';

describe('ContextMonitor', () => {
  let monitor: ContextMonitor;

  beforeEach(() => {
    // Use 100K window for easier math
    monitor = new ContextMonitor('test-tab', 100_000);
  });

  it('should return "ok" below 80% threshold', () => {
    expect(monitor.recordUsage(makeUsage(70000))).toBe('ok');
  });

  it('should return "warn" at 80%', () => {
    expect(monitor.recordUsage(makeUsage(80000))).toBe('warn');
  });

  it('should return "warn" only once', () => {
    monitor.recordUsage(makeUsage(80000));
    expect(monitor.recordUsage(makeUsage(1000))).toBe('ok');
  });

  it('should return "checkpoint" at 90%', () => {
    expect(monitor.recordUsage(makeUsage(90000))).toBe('checkpoint');
  });

  it('should accumulate tokens across calls', () => {
    monitor.recordUsage(makeUsage(30000));
    monitor.recordUsage(makeUsage(30000));
    expect(monitor.tokenCount).toBe(60000);
    expect(monitor.usageRatio).toBeCloseTo(0.6);
  });

  it('should count output tokens toward threshold', () => {
    // 40K input + 40K output = 80K = 80% of 100K window → triggers warn
    expect(monitor.recordUsage(makeUsage(40000, 40000))).toBe('warn');
    expect(monitor.tokenCount).toBe(80000);
  });

  it('should reset state', () => {
    monitor.recordUsage(makeUsage(85000));
    monitor.reset();
    expect(monitor.tokenCount).toBe(0);
    expect(monitor.recordUsage(makeUsage(50000))).toBe('ok');
  });
});
