import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateTabName, getTabConfig, resolveWorkingDir, getAdminUserId } from '../../src/config.js';

// Mock fs and paths so getConfig doesn't hit the real filesystem
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false), // no config file → use defaults
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

vi.mock('../../src/util/paths.js', () => ({
  getConfigPath: () => '/tmp/test-config.json',
  expandHome: (p: string) => p.replace('~', '/home/test'),
  getBeecorkHome: () => '/tmp/.beecork',
}));

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

  describe('getTabConfig', () => {
    it('should return default config for unknown tab', () => {
      const config = getTabConfig('nonexistent');
      expect(config.approvalMode).toBe('yolo');
      expect(config.approvalTimeoutMinutes).toBe(30);
    });

    it('should return default tab config for "default"', () => {
      const config = getTabConfig('default');
      expect(config.approvalMode).toBe('yolo');
    });
  });

  describe('resolveWorkingDir', () => {
    it('should expand ~ in working dir path', () => {
      const dir = resolveWorkingDir('default');
      // expandHome is mocked to replace ~ with /home/test
      expect(dir).not.toContain('~');
    });
  });

  describe('getAdminUserId', () => {
    it('should return first allowedUserId when no adminUserId set', () => {
      // With default config (no file), allowedUserIds is [] so returns undefined
      const id = getAdminUserId();
      expect(id).toBeUndefined();
    });
  });
});
