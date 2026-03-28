import { describe, it, expect } from 'vitest';
import { intervalToCron } from '../../src/cron/scheduler.js';

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

  it('should convert combined intervals', () => {
    const result = intervalToCron('1h30m');
    expect(result).toBe('*/90 * * * *');
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
