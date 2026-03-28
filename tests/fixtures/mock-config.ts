import type { BeecorkConfig, StreamContentToolUse, StreamUsage } from '../../src/types.js';

export const mockConfig: BeecorkConfig = {
  telegram: { token: 'test-token', allowedUserIds: [123] },
  claudeCode: { bin: 'claude', defaultFlags: [] },
  tabs: { default: { workingDir: '/tmp', approvalMode: 'yolo', approvalTimeoutMinutes: 30, debounceMs: 1500 } },
  memory: { enabled: true, dbPath: '/tmp/test.db', maxLongTermEntries: 1000 },
  deployment: 'local',
};

export function makeToolUse(name: string, input: Record<string, unknown> = {}): StreamContentToolUse {
  return { type: 'tool_use', id: 'tu-1', name, input };
}

export function makeUsage(input: number, output: number = 0): StreamUsage {
  return { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
}
