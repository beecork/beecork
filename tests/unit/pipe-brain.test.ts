import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRoute = vi.fn();
const mockEvaluateGoal = vi.fn();
const mockExtractKnowledge = vi.fn();

vi.mock('../../src/pipe/anthropic-client.js', () => ({
  PipeAnthropicClient: vi.fn().mockImplementation(() => ({
    route: mockRoute,
    evaluateGoal: mockEvaluateGoal,
    extractKnowledge: mockExtractKnowledge,
  })),
}));

vi.mock('../../src/pipe/memory-store.js', () => ({
  PipeMemoryStore: vi.fn().mockImplementation(() => ({
    getProjects: vi.fn().mockReturnValue([]),
    getRecentRouting: vi.fn().mockReturnValue([]),
    recordRouting: vi.fn(),
    updateProjectLastUsed: vi.fn(),
    getKnowledge: vi.fn().mockReturnValue([]),
    addKnowledge: vi.fn(),
    upsertProject: vi.fn(),
  })),
}));

vi.mock('../../src/pipe/project-scanner.js', () => ({
  scanForProjects: vi.fn().mockReturnValue([]),
}));

vi.mock('../../src/util/text.js', () => ({
  parseTabMessage: vi.fn().mockImplementation((msg: string) => {
    const match = msg.match(/^\/tab\s+(\S+)/);
    return { tabName: match?.[1] || 'default', message: msg };
  }),
}));

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PipeBrain } from '../../src/pipe/brain.js';
import type { BeecorkConfig } from '../../src/types.js';

const mockConfig: BeecorkConfig = {
  telegram: { token: '', allowedUserIds: [] },
  claudeCode: { bin: 'claude', defaultFlags: [] },
  tabs: { default: { workingDir: '/tmp', approvalMode: 'yolo', approvalTimeoutMinutes: 30 } },
  memory: { enabled: true, dbPath: '/tmp/test.db', maxLongTermEntries: 1000 },
  pipe: {
    enabled: true,
    anthropicApiKey: 'test-key',
    routingModel: 'haiku',
    complexModel: 'sonnet',
    confidenceThreshold: 0.75,
    projectScanPaths: [],
    maxFollowUps: 3,
  },
  deployment: 'local',
};

function makeTabManager() {
  return {
    ensureTab: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue({ text: 'Done!', error: false, costUsd: 0.01, durationMs: 5000 }),
    listTabs: vi.fn().mockReturnValue([]),
    stopTab: vi.fn(),
  } as any;
}

describe('PipeBrain', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractKnowledge.mockResolvedValue([]);
    mockEvaluateGoal.mockResolvedValue({ status: 'done', reason: 'completed', followUp: null });
  });

  it('should route /tab prefix directly without API call', async () => {
    const tm = makeTabManager();
    const brain = new PipeBrain(mockConfig, tm);

    await brain.process('/tab research do something', { userId: 'u1', channelId: 'tg' });

    expect(mockRoute).not.toHaveBeenCalled();
    expect(tm.sendMessage).toHaveBeenCalled();
  });

  it('should route to default when no projects exist', async () => {
    const tm = makeTabManager();
    const brain = new PipeBrain(mockConfig, tm);

    const result = await brain.process('hello', { userId: 'u1', channelId: 'tg' });

    expect(mockRoute).not.toHaveBeenCalled();
    expect(result.tabName).toBe('default');
  });

  it('should handle Claude Code send error gracefully', async () => {
    const tm = makeTabManager();
    tm.sendMessage.mockRejectedValue(new Error('subprocess crashed'));
    const brain = new PipeBrain(mockConfig, tm);

    const result = await brain.process('hello', { userId: 'u1', channelId: 'tg' });

    expect(result.response.error).toBe(true);
    expect(result.response.text).toContain('subprocess crashed');
  });

  it('should skip goal evaluation for short responses', async () => {
    const tm = makeTabManager();
    tm.sendMessage.mockResolvedValue({ text: 'Quick answer', error: false, costUsd: 0.001, durationMs: 500 });
    const brain = new PipeBrain(mockConfig, tm);

    await brain.process('what time is it', { userId: 'u1', channelId: 'tg' });

    expect(mockEvaluateGoal).not.toHaveBeenCalled();
  });

  it('should evaluate goal for long responses', async () => {
    const tm = makeTabManager();
    tm.sendMessage.mockResolvedValue({ text: 'I fixed the bug by changing line 42...', error: false, costUsd: 0.05, durationMs: 10000 });
    const brain = new PipeBrain(mockConfig, tm);

    await brain.process('fix the bug', { userId: 'u1', channelId: 'tg' });

    expect(mockEvaluateGoal).toHaveBeenCalled();
  });

  it('should skip learning for short responses', async () => {
    const tm = makeTabManager();
    tm.sendMessage.mockResolvedValue({ text: 'ok', error: false, costUsd: 0, durationMs: 100 });
    const brain = new PipeBrain(mockConfig, tm);

    await brain.process('hello', { userId: 'u1', channelId: 'tg' });

    expect(mockExtractKnowledge).not.toHaveBeenCalled();
  });
});
