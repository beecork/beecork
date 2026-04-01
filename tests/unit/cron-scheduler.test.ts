import { describe, it, expect } from 'vitest';
import { intervalToCron, intervalToMs } from '../../src/tasks/scheduler.js';

describe('intervalToCron', () => {
  it('should convert minutes', () => {
    expect(intervalToCron('30m')).toBe('*/30 * * * *');
    expect(intervalToCron('5m')).toBe('*/5 * * * *');
    expect(intervalToCron('1m')).toBe('*/1 * * * *');
  });

  it('should convert hours', () => {
    expect(intervalToCron('2h')).toBe('0 */2 * * *');
    expect(intervalToCron('1h')).toBe('0 */1 * * *');
  });

  it('should convert days', () => {
    expect(intervalToCron('1d')).toBe('0 0 */1 * *');
    expect(intervalToCron('7d')).toBe('0 0 */7 * *');
  });

  it('should convert weeks', () => {
    expect(intervalToCron('1w')).toBe('0 0 * * 0');
  });

  it('should return null for combined intervals (handled by setInterval)', () => {
    expect(intervalToCron('1h30m')).toBeNull();
    expect(intervalToCron('2h15m')).toBeNull();
  });

  it('should return null for invalid input', () => {
    expect(intervalToCron('')).toBeNull();
    expect(intervalToCron('invalid')).toBeNull();
    expect(intervalToCron('abc123')).toBeNull();
  });

  it('should return null for zero interval', () => {
    expect(intervalToCron('0m')).toBeNull();
  });
});

describe('intervalToMs', () => {
  it('should convert minutes to milliseconds', () => {
    expect(intervalToMs('30m')).toBe(30 * 60 * 1000);
    expect(intervalToMs('5m')).toBe(5 * 60 * 1000);
  });

  it('should convert hours to milliseconds', () => {
    expect(intervalToMs('2h')).toBe(2 * 60 * 60 * 1000);
  });

  it('should convert combined intervals', () => {
    expect(intervalToMs('1h30m')).toBe((60 + 30) * 60 * 1000);
    expect(intervalToMs('2h15m')).toBe((120 + 15) * 60 * 1000);
  });

  it('should convert weeks', () => {
    expect(intervalToMs('1w')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('should convert days', () => {
    expect(intervalToMs('1d')).toBe(24 * 60 * 60 * 1000);
  });

  it('should return null for invalid input', () => {
    expect(intervalToMs('')).toBeNull();
    expect(intervalToMs('invalid')).toBeNull();
    expect(intervalToMs('abc')).toBeNull();
  });

  it('should return null for zero interval', () => {
    expect(intervalToMs('0m')).toBeNull();
  });
});
