import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker } from '../../src/session/circuit-breaker.js';
import { makeToolUse } from '../fixtures/mock-config.js';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test-tab', { maxRepeats: 20, windowSize: 30 });
  });

  it('should return "ok" for non-repeating calls', () => {
    expect(breaker.recordToolCall(makeToolUse('Read', { path: '/a' }))).toBe('ok');
    expect(breaker.recordToolCall(makeToolUse('Read', { path: '/b' }))).toBe('ok');
    expect(breaker.recordToolCall(makeToolUse('Write', { path: '/c' }))).toBe('ok');
  });

  it('should return "ok" for first 4 identical calls', () => {
    for (let i = 0; i < 4; i++) {
      expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('ok');
    }
  });

  it('should return "warn" at 5 identical calls', () => {
    for (let i = 0; i < 4; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('warn');
  });

  it('should only warn once', () => {
    for (let i = 0; i < 5; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    // 6th call should be ok, not another warn
    expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('ok');
  });

  it('should return "notify" at 10 identical calls', () => {
    for (let i = 0; i < 9; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('notify');
  });

  it('should return "break" at 20 identical calls', () => {
    for (let i = 0; i < 19; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('break');
    expect(breaker.isTripped).toBe(true);
  });

  it('should always return "break" once tripped', () => {
    for (let i = 0; i < 20; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    expect(breaker.recordToolCall(makeToolUse('Read', { path: '/new' }))).toBe('break');
  });

  it('should not count different tools as repeats', () => {
    for (let i = 0; i < 10; i++) {
      breaker.recordToolCall(makeToolUse('Read', { path: `/file${i}` }));
    }
    expect(breaker.isTripped).toBe(false);
  });

  it('should reset state', () => {
    for (let i = 0; i < 15; i++) {
      breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }));
    }
    breaker.reset();
    expect(breaker.isTripped).toBe(false);
    expect(breaker.recordToolCall(makeToolUse('Bash', { command: 'ls' }))).toBe('ok');
  });
});
