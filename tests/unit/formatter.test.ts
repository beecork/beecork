import { describe, it, expect } from 'vitest';
import { chunkText, formatTabStatus } from '../../src/telegram/formatter.js';

describe('Telegram Formatter', () => {
  describe('chunkText', () => {
    it('should not split short text', () => {
      expect(chunkText('hello')).toEqual(['hello']);
    });

    it('should split at Telegram limit (4096)', () => {
      const text = 'a'.repeat(5000);
      const chunks = chunkText(text);
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(4096);
      expect(chunks[1].length).toBe(904);
    });

    it('should split at newline boundary when possible', () => {
      const line = 'x'.repeat(2000);
      const text = `${line}\n${line}\n${line}`;
      const chunks = chunkText(text);
      expect(chunks.length).toBe(2);
      expect(chunks[0].endsWith('\n' + line)).toBe(true);
    });

    it('should split at space when no newline', () => {
      const text = ('word '.repeat(1000)).trim();
      const chunks = chunkText(text);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(4096);
      }
    });

    it('should handle custom max length', () => {
      const text = 'hello world this is a test';
      const chunks = chunkText(text, 10);
      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('formatTabStatus', () => {
    it('should return "No tabs." for empty array', () => {
      expect(formatTabStatus([])).toBe('No tabs.');
    });

    it('should format tab list', () => {
      const tabs = [
        { name: 'default', status: 'idle', lastActivityAt: new Date().toISOString() },
        { name: 'research', status: 'running', lastActivityAt: new Date(Date.now() - 3600000).toISOString() },
      ];
      const result = formatTabStatus(tabs);
      expect(result).toContain('default');
      expect(result).toContain('idle');
      expect(result).toContain('research');
      expect(result).toContain('running');
      expect(result).toContain('just now');
      expect(result).toContain('1h ago');
    });
  });
});
