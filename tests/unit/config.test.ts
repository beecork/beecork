import { describe, it, expect } from 'vitest';
import { validateTabName } from '../../src/config.js';

describe('Config', () => {
  describe('validateTabName', () => {
    it('should accept valid names', () => {
      expect(validateTabName('research')).toBeNull();
      expect(validateTabName('my-task')).toBeNull();
      expect(validateTabName('deploy-123')).toBeNull();
      expect(validateTabName('a')).toBeNull();
    });

    it('should reject "default" (reserved)', () => {
      expect(validateTabName('default')).toContain('reserved');
    });

    it('should reject "cron:" prefix (reserved)', () => {
      expect(validateTabName('cron:morning')).toContain('reserved');
    });

    it('should reject names with special characters', () => {
      expect(validateTabName('my tab')).not.toBeNull();
      expect(validateTabName('my.tab')).not.toBeNull();
      expect(validateTabName('my/tab')).not.toBeNull();
    });

    it('should reject names over 32 characters', () => {
      expect(validateTabName('a'.repeat(33))).not.toBeNull();
    });

    it('should accept names at exactly 32 characters', () => {
      expect(validateTabName('a'.repeat(32))).toBeNull();
    });

    it('should reject empty names', () => {
      expect(validateTabName('')).not.toBeNull();
    });
  });
});
