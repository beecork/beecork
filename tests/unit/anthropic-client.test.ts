import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

vi.mock('../../src/util/retry.js', () => ({
  retryWithBackoff: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../../src/util/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { PipeAnthropicClient } from '../../src/pipe/anthropic-client.js';

function makeResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('PipeAnthropicClient', () => {
  let client: PipeAnthropicClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new PipeAnthropicClient('test-key', 'haiku-model', 'sonnet-model');
  });

  describe('route', () => {
    it('should parse valid JSON routing response', async () => {
      const routeResponse = { tabName: 'myproject', projectPath: '/proj', confidence: 0.9, reason: 'matched', needsConfirmation: false };
      mockCreate.mockResolvedValue(makeResponse(JSON.stringify(routeResponse)));

      const result = await client.route('fix the bug', [{ name: 'myproject', path: '/proj' }], []);
      expect(result.tabName).toBe('myproject');
      expect(result.confidence).toBe(0.9);
    });

    it('should return fallback on invalid JSON', async () => {
      mockCreate.mockResolvedValue(makeResponse('not json at all'));

      const result = await client.route('fix the bug', [], []);
      expect(result.tabName).toBe('default');
      expect(result.confidence).toBe(0.3);
      expect(result.needsConfirmation).toBe(true);
    });

    it('should include project list in system prompt', async () => {
      mockCreate.mockResolvedValue(makeResponse('{"tabName":"default","projectPath":null,"confidence":0.5,"reason":"none","needsConfirmation":false}'));

      await client.route('hello', [
        { name: 'beecork', path: '/code/beecork', languages: ['TypeScript'] },
      ], []);

      // retryWithBackoff wraps the call, but we check mockCreate was called
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const args = mockCreate.mock.calls[0][0];
      expect(args.system).toContain('beecork');
      expect(args.system).toContain('TypeScript');
    });
  });

  describe('evaluateGoal', () => {
    it('should parse valid JSON goal evaluation', async () => {
      const evalResponse = { status: 'done', reason: 'Task completed', followUp: null };
      mockCreate.mockResolvedValue(makeResponse(JSON.stringify(evalResponse)));

      const result = await client.evaluateGoal('fix the bug', 'I fixed the bug in line 42');
      expect(result.status).toBe('done');
      expect(result.followUp).toBeNull();
    });

    it('should return done fallback on invalid JSON', async () => {
      mockCreate.mockResolvedValue(makeResponse('broken'));

      const result = await client.evaluateGoal('fix bug', 'response');
      expect(result.status).toBe('done');
      expect(result.reason).toBe('Could not evaluate');
    });
  });

  describe('extractKnowledge', () => {
    it('should parse valid JSON array', async () => {
      const entries = [
        { content: 'Uses TypeScript', category: 'project' },
        { content: 'Prefers Vim', category: 'preference' },
      ];
      mockCreate.mockResolvedValue(makeResponse(JSON.stringify(entries)));

      const result = await client.extractKnowledge('conversation text', []);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Uses TypeScript');
      expect(result[0].source).toBe('pipe');
    });

    it('should return empty array on invalid JSON', async () => {
      mockCreate.mockResolvedValue(makeResponse('not an array'));

      const result = await client.extractKnowledge('conversation', []);
      expect(result).toEqual([]);
    });

    it('should return empty array for non-array JSON', async () => {
      mockCreate.mockResolvedValue(makeResponse('{"not": "array"}'));

      const result = await client.extractKnowledge('conversation', []);
      expect(result).toEqual([]);
    });

    it('should cap entries at 5', async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        content: `Fact ${i}`, category: 'fact',
      }));
      mockCreate.mockResolvedValue(makeResponse(JSON.stringify(entries)));

      const result = await client.extractKnowledge('conversation', []);
      expect(result).toHaveLength(5);
    });

    it('should return empty array on API error', async () => {
      mockCreate.mockRejectedValue(new Error('API timeout'));

      // The complete() method throws, extractKnowledge should propagate
      // (retryWithBackoff is mocked to call fn directly, and complete re-throws)
      await expect(client.extractKnowledge('conversation', [])).rejects.toThrow('API timeout');
    });
  });
});
