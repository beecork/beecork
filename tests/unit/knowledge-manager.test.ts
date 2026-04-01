import { describe, it, expect } from 'vitest';
import { formatKnowledgeForContext } from '../../src/knowledge/manager.js';
import type { KnowledgeEntry } from '../../src/knowledge/types.js';

describe('formatKnowledgeForContext', () => {
  it('should return empty string for no entries', () => {
    expect(formatKnowledgeForContext([])).toBe('');
  });

  it('should format global entries with header and category', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'User prefers dark mode', scope: 'global', source: 'preferences.md', category: 'preferences' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).toContain('[Your knowledge (global)]');
    expect(result).toContain('[preferences]');
    expect(result).toContain('User prefers dark mode');
  });

  it('should format global entries without category', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'Some fact', scope: 'global', source: 'general.md' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).toContain('[Your knowledge (global)]');
    expect(result).not.toContain('[undefined]');
    expect(result).toContain('Some fact');
  });

  it('should format project entries with header', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'Uses TypeScript strict mode', scope: 'project', source: '/proj/.beecork/knowledge.md' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).toContain('[Project knowledge]');
    expect(result).toContain('Uses TypeScript strict mode');
  });

  it('should format tab entries with header and bullet prefix', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'User asked about cron jobs', scope: 'tab', source: 'research' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).toContain('[Context from memory]');
    expect(result).toContain('- User asked about cron jobs');
  });

  it('should combine all three layers in correct order', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'Global fact', scope: 'global', source: 'general.md', category: 'general' },
      { content: 'Project convention', scope: 'project', source: '/proj/knowledge.md' },
      { content: 'Tab memory', scope: 'tab', source: 'default' },
    ];
    const result = formatKnowledgeForContext(entries);

    const globalIdx = result.indexOf('[Your knowledge (global)]');
    const projectIdx = result.indexOf('[Project knowledge]');
    const tabIdx = result.indexOf('[Context from memory]');

    expect(globalIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(tabIdx);
  });

  it('should handle multiple entries per scope', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'Fact 1', scope: 'global', source: 'people.md', category: 'people' },
      { content: 'Fact 2', scope: 'global', source: 'routines.md', category: 'routines' },
      { content: 'Memory 1', scope: 'tab', source: 'default' },
      { content: 'Memory 2', scope: 'tab', source: 'default' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).toContain('Fact 1');
    expect(result).toContain('Fact 2');
    expect(result).toContain('- Memory 1');
    expect(result).toContain('- Memory 2');
  });

  it('should only include sections that have entries', () => {
    const entries: KnowledgeEntry[] = [
      { content: 'Just a tab memory', scope: 'tab', source: 'default' },
    ];
    const result = formatKnowledgeForContext(entries);
    expect(result).not.toContain('[Your knowledge (global)]');
    expect(result).not.toContain('[Project knowledge]');
    expect(result).toContain('[Context from memory]');
  });
});
