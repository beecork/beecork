import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../src/util/paths.js', () => ({
  getMcpConfigPath: () => '/tmp/.beecork/mcp.json',
}));

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: vi.fn().mockReturnValue('test-uuid-1234'),
}));

import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { ClaudeSubprocess } from '../../src/session/subprocess.js';
import type { BeecorkConfig } from '../../src/types.js';

const mockConfig: BeecorkConfig = {
  telegram: { token: '', allowedUserIds: [] },
  claudeCode: { bin: 'claude', defaultFlags: ['--dangerously-skip-permissions'] },
  tabs: { default: { workingDir: '/tmp', approvalMode: 'yolo', approvalTimeoutMinutes: 30 } },
  memory: { enabled: true, dbPath: '/tmp/test.db', maxLongTermEntries: 1000 },
  deployment: 'local',
};

function makeMockProc() {
  const proc = {
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  };
  vi.mocked(spawn).mockReturnValue(proc as any);
  return proc;
}

describe('ClaudeSubprocess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a session ID when none provided', () => {
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    expect(sub.sessionId).toBe('test-uuid-1234');
  });

  it('should use provided session ID', () => {
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig, 'custom-id');
    expect(sub.sessionId).toBe('custom-id');
  });

  it('should include standard flags in spawn args', async () => {
    const proc = makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);

    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('hello'); // prompt at the end
  });

  it('should include --session-id on fresh session', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--session-id');
    expect(args).toContain('test-uuid-1234');
    expect(args).not.toContain('--resume');
  });

  it('should include --resume on resume', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig, 'session-abc');
    await sub.send('continue', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() }, true);

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--resume');
    expect(args).toContain('session-abc');
    expect(args).not.toContain('--session-id');
  });

  it('should include --system-prompt on fresh session', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--system-prompt');
    // System prompt should contain Beecork context
    const promptIdx = args.indexOf('--system-prompt') + 1;
    expect(args[promptIdx]).toContain('Beecork');
  });

  it('should NOT include --system-prompt on resume', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() }, true);

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--system-prompt');
  });

  it('should include tab-specific system prompt', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig, undefined, 'You are a code reviewer');
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    const promptIdx = args.indexOf('--system-prompt') + 1;
    expect(args[promptIdx]).toContain('You are a code reviewer');
    expect(args[promptIdx]).toContain('test'); // tab name
  });

  it('should include --mcp-config when file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--mcp-config');
    expect(args).toContain('/tmp/.beecork/mcp.json');
  });

  it('should NOT include --mcp-config when file does not exist', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).not.toContain('--mcp-config');
  });

  it('should include --computer-use when configured', async () => {
    makeMockProc();
    const config = { ...mockConfig, claudeCode: { ...mockConfig.claudeCode, computerUse: true } };
    const sub = new ClaudeSubprocess('test', '/tmp', config);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--computer-use');
  });

  it('should include --max-budget-usd when configured', async () => {
    makeMockProc();
    const config = { ...mockConfig, claudeCode: { ...mockConfig.claudeCode, maxBudgetUsd: 5 } };
    const sub = new ClaudeSubprocess('test', '/tmp', config);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    const args = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(args).toContain('--max-budget-usd');
    expect(args).toContain('5');
  });

  it('should throw on double-send', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('first', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    await expect(
      sub.send('second', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() })
    ).rejects.toThrow('already running');
  });

  it('should report isRunning correctly', async () => {
    makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    expect(sub.isRunning).toBe(false);

    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });
    expect(sub.isRunning).toBe(true);
  });

  it('should kill process with SIGTERM', async () => {
    const proc = makeMockProc();
    const sub = new ClaudeSubprocess('test', '/tmp', mockConfig);
    await sub.send('hello', { onEvent: vi.fn(), onExit: vi.fn(), onError: vi.fn() });

    sub.kill();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
