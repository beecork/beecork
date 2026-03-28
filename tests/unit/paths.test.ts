import { describe, it, expect } from 'vitest';
import { expandHome } from '../../src/util/paths.js';
import os from 'node:os';

describe('Paths', () => {
  describe('expandHome', () => {
    it('should expand ~ to home directory', () => {
      expect(expandHome('~')).toBe(os.homedir());
    });

    it('should expand ~/path', () => {
      expect(expandHome('~/Documents')).toBe(`${os.homedir()}/Documents`);
    });

    it('should not alter absolute paths', () => {
      expect(expandHome('/usr/local/bin')).toBe('/usr/local/bin');
    });

    it('should not alter relative paths', () => {
      expect(expandHome('relative/path')).toBe('relative/path');
    });
  });
});
