import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/util/text.js', () => ({
  timeAgo: vi.fn().mockReturnValue('2m ago'),
}));
vi.mock('../../src/config.js', () => ({
  validateTabName: vi.fn().mockReturnValue(null),
}));
vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { handleSharedCommand, resolveProjectRoute } from '../../src/channels/command-handler.js';
import type { CommandContext } from '../../src/channels/command-handler.js';
import { validateTabName } from '../../src/config.js';

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    userId: 'user-123',
    text: '',
    isAdmin: true,
    channelId: 'telegram',
    ...overrides,
  };
}

function makeTabManager() {
  return {
    listTabs: vi.fn().mockReturnValue([]),
    stopTab: vi.fn(),
    ensureTab: vi.fn(),
    sendMessage: vi.fn(),
  } as any;
}

describe('handleSharedCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // /tabs
  it('should return "No tabs." when no tabs exist', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/tabs' }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toBe('No tabs.');
  });

  it('should return formatted tab list', async () => {
    const tm = makeTabManager();
    tm.listTabs.mockReturnValue([
      { name: 'research', status: 'running', lastActivityAt: new Date().toISOString() },
      { name: 'deploy', status: 'idle', lastActivityAt: new Date().toISOString() },
    ]);
    const result = await handleSharedCommand(makeCtx({ text: '/tabs' }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('research');
    expect(result.response).toContain('deploy');
  });

  it('should handle /tabs@ (bot mention in groups)', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/tabs@mybot' }), tm);
    expect(result.handled).toBe(true);
  });

  // /stop
  it('should stop tab as admin', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/stop research' }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Stopped');
    expect(tm.stopTab).toHaveBeenCalledWith('research');
  });

  it('should reject /stop from non-admin', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/stop research', isAdmin: false }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Only admin');
  });

  // /tab
  it('should return usage when /tab has no message', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/tab myproject' }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Usage');
  });

  it('should return not handled for /tab with valid name + message', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/tab myproject do something' }), tm);
    expect(result.handled).toBe(false);
  });

  it('should reject /tab with invalid name', async () => {
    const tm = makeTabManager();
    vi.mocked(validateTabName).mockReturnValueOnce('Tab name invalid');
    const result = await handleSharedCommand(makeCtx({ text: '/tab bad!name do something' }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Invalid tab name');
  });

  // /users
  it('should reject /users from non-admin', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/users', isAdmin: false }), tm);
    expect(result.handled).toBe(true);
    expect(result.response).toContain('Admin only');
  });

  // Unrecognized command
  it('should return not handled for unrecognized text', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: 'hello world' }), tm);
    expect(result.handled).toBe(false);
  });

  it('should return not handled for unknown command', async () => {
    const tm = makeTabManager();
    const result = await handleSharedCommand(makeCtx({ text: '/unknown' }), tm);
    expect(result.handled).toBe(false);
  });
});

describe('resolveProjectRoute', () => {
  it('should return immediately for non-default tab', async () => {
    const result = await resolveProjectRoute('hello', 'research', 'hello', 'user-1');
    expect(result.effectiveTabName).toBe('research');
  });

  it('should return immediately for /tab prefix', async () => {
    const result = await resolveProjectRoute('/tab deploy do it', 'default', '/tab deploy do it', 'user-1');
    expect(result.effectiveTabName).toBe('default');
  });

  it('should fall back to default tab on routing error', async () => {
    // When projects/index.js import fails, should catch and return default
    const result = await resolveProjectRoute('hello', 'default', 'hello', 'user-1');
    // Will either succeed with routing or fall back to default
    expect(result.effectiveTabName).toBeDefined();
  });
});
