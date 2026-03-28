import { describe, it, expect } from 'vitest';
import { classifyTool } from '../../src/session/tool-classifier.js';

describe('Tool Classifier', () => {
  describe('safe tools', () => {
    it.each(['Read', 'Glob', 'Grep', 'LSP', 'WebFetch', 'WebSearch', 'ToolSearch', 'TaskGet', 'TaskList'])(
      'should classify %s as safe', (tool) => {
        expect(classifyTool(tool, {})).toBe('safe');
      }
    );
  });

  describe('dangerous tools', () => {
    it.each(['Write', 'Edit', 'NotebookEdit', 'TaskCreate', 'TaskUpdate', 'TaskStop'])(
      'should classify %s as dangerous', (tool) => {
        expect(classifyTool(tool, {})).toBe('dangerous');
      }
    );
  });

  describe('bash commands - safe', () => {
    it.each([
      'ls -la', 'cat file.txt', 'head -20 file', 'git status', 'git log',
      'git diff', 'pwd', 'whoami', 'find . -name "*.ts"', 'grep pattern',
      'node --version', 'npm list',
    ])('should classify "Bash: %s" as safe', (cmd) => {
      expect(classifyTool('Bash', { command: cmd })).toBe('safe');
    });
  });

  describe('bash commands - dangerous', () => {
    it.each([
      'rm -rf /', 'git push', 'git reset --hard', 'docker run',
      'npm install', 'npm publish', 'sudo rm', 'kill -9 123',
      'curl -X POST https://api.example.com',
    ])('should classify "Bash: %s" as dangerous', (cmd) => {
      expect(classifyTool('Bash', { command: cmd })).toBe('dangerous');
    });
  });

  it('should classify unknown bash commands as dangerous', () => {
    expect(classifyTool('Bash', { command: 'some-unknown-command' })).toBe('dangerous');
  });

  it('should classify MCP tools as dangerous', () => {
    expect(classifyTool('mcp__server__tool', {})).toBe('dangerous');
  });

  it('should classify unknown tools as dangerous', () => {
    expect(classifyTool('SomeNewTool', {})).toBe('dangerous');
  });
});
