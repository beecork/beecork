import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tasks/scheduler.js', () => ({
  execAsync: vi.fn(),
}));

import { execAsync } from '../../src/tasks/scheduler.js';
import { evaluateWatcher } from '../../src/watchers/evaluator.js';

const mockExecAsync = vi.mocked(execAsync);
import type { Watcher } from '../../src/watchers/types.js';

function makeWatcher(overrides: Partial<Watcher> = {}): Watcher {
  return {
    id: 'w1',
    name: 'test-watcher',
    checkCommand: 'echo test',
    condition: 'any',
    action: 'notify',
    actionTarget: '',
    schedule: 'every 5m',
    enabled: true,
    ...overrides,
  };
}

describe('evaluateWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- contains ---
  it('should trigger on "contains X" when output includes X', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'disk usage is high\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'contains high' }));
    expect(result.triggered).toBe(true);
    expect(result.output).toBe('disk usage is high');
  });

  it('should not trigger on "contains X" when output lacks X', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'disk usage is low\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'contains high' }));
    expect(result.triggered).toBe(false);
  });

  // --- not contains ---
  it('should trigger on "not contains X" when output lacks X', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'all good\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'not contains error' }));
    expect(result.triggered).toBe(true);
  });

  it('should not trigger on "not contains X" when output includes X', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'error occurred\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'not contains error' }));
    expect(result.triggered).toBe(false);
  });

  // --- > threshold ---
  it('should trigger on "> N" when output exceeds threshold', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '95\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: '> 90' }));
    expect(result.triggered).toBe(true);
  });

  it('should not trigger on "> N" when output is below threshold', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '50\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: '> 90' }));
    expect(result.triggered).toBe(false);
  });

  it('should trigger on "> N" when output is non-numeric (NaN)', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'not a number\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: '> 90' }));
    expect(result.triggered).toBe(true); // NaN = something wrong = trigger
  });

  // --- < threshold ---
  it('should trigger on "< N" when output is below threshold', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '5\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: '< 10' }));
    expect(result.triggered).toBe(true);
  });

  it('should trigger on "< N" when output is non-numeric (NaN)', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'abc\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: '< 10' }));
    expect(result.triggered).toBe(true);
  });

  // --- any ---
  it('should trigger on "any" with non-empty output', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'something\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'any' }));
    expect(result.triggered).toBe(true);
  });

  it('should not trigger on "any" with empty output', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'any' }));
    expect(result.triggered).toBe(false);
  });

  // --- error ---
  it('should not trigger "error" on successful command', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'all ok\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'error' }));
    expect(result.triggered).toBe(false);
  });

  it('should trigger "error" on command failure', async () => {
    mockExecAsync.mockRejectedValue(new Error('command not found'));
    const result = await evaluateWatcher(makeWatcher({ condition: 'error' }));
    expect(result.triggered).toBe(true);
    expect(result.output).toContain('Check failed');
  });

  // --- default condition ---
  it('should trigger default condition on non-empty non-ok output', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'something happened\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'changed' }));
    expect(result.triggered).toBe(true);
  });

  it('should not trigger default condition when output is "ok"', async () => {
    mockExecAsync.mockResolvedValue({ stdout: 'ok\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'changed' }));
    expect(result.triggered).toBe(false);
  });

  it('should not trigger default condition on empty output', async () => {
    mockExecAsync.mockResolvedValue({ stdout: '\n' });
    const result = await evaluateWatcher(makeWatcher({ condition: 'changed' }));
    expect(result.triggered).toBe(false);
  });

  // --- truncation ---
  it('should truncate output longer than 10240 chars', async () => {
    const longOutput = 'x'.repeat(20000) + '\n';
    mockExecAsync.mockResolvedValue({ stdout: longOutput });
    const result = await evaluateWatcher(makeWatcher({ condition: 'any' }));
    expect(result.output.length).toBeLessThanOrEqual(10240 + ' [truncated]'.length);
    expect(result.output).toContain('[truncated]');
  });

  // --- command failure with non-error condition ---
  it('should not trigger non-error condition on command failure', async () => {
    mockExecAsync.mockRejectedValue(new Error('timeout'));
    const result = await evaluateWatcher(makeWatcher({ condition: 'contains test' }));
    expect(result.triggered).toBe(false);
    expect(result.output).toContain('Check failed');
  });

  it('should trigger "any" on command failure', async () => {
    mockExecAsync.mockRejectedValue(new Error('timeout'));
    const result = await evaluateWatcher(makeWatcher({ condition: 'any' }));
    expect(result.triggered).toBe(true);
  });
});
