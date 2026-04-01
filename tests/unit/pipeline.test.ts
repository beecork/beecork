import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processInboundMessage } from '../../src/channels/pipeline.js';
import type { PipelineOptions } from '../../src/channels/pipeline.js';
import type { TabManager } from '../../src/session/manager.js';
import type { TTSProvider } from '../../src/voice/tts.js';

// Mock the dynamic import for command-handler
vi.mock('../../src/channels/command-handler.js', () => ({
  resolveProjectRoute: vi.fn().mockResolvedValue({
    effectiveTabName: 'default',
    projectPath: undefined,
    confirmationMessage: undefined,
  }),
}));

// Mock logger to silence output
vi.mock('../../src/util/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// Mock ProgressTracker
vi.mock('../../src/util/progress.js', () => ({
  ProgressTracker: vi.fn().mockImplementation(() => ({
    record: vi.fn(),
    stop: vi.fn(),
  })),
}));

function makeTabManager(overrides: Partial<TabManager['sendMessage']> = {}): TabManager {
  return {
    sendMessage: vi.fn().mockResolvedValue({ text: 'Hello from Claude', error: false }),
  } as unknown as TabManager;
}

function makeOpts(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    text: 'hello world',
    media: [],
    channelId: 'test-channel',
    tabManager: makeTabManager(),
    userId: 'user-1',
    sendProgress: vi.fn(),
    ...overrides,
  };
}

describe('processInboundMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return response text on normal message', async () => {
    const opts = makeOpts();
    const result = await processInboundMessage(opts);

    expect(result.responseText).toBe('Hello from Claude');
    expect(result.isError).toBe(false);
    expect(result.tabName).toBe('default');
  });

  it('should prefix "Error: " when sendMessage returns an error', async () => {
    const tabManager = {
      sendMessage: vi.fn().mockResolvedValue({ text: 'something went wrong', error: true }),
    } as unknown as TabManager;

    const result = await processInboundMessage(makeOpts({ tabManager }));

    expect(result.responseText).toBe('Error: something went wrong');
    expect(result.isError).toBe(true);
  });

  it('should return "(empty response)" when sendMessage returns empty text', async () => {
    const tabManager = {
      sendMessage: vi.fn().mockResolvedValue({ text: '', error: false }),
    } as unknown as TabManager;

    const result = await processInboundMessage(makeOpts({ tabManager }));

    expect(result.responseText).toBe('(empty response)');
    expect(result.isError).toBe(false);
  });

  it('should use overrideTabName over parsed tab', async () => {
    const { resolveProjectRoute } = await import('../../src/channels/command-handler.js');
    (resolveProjectRoute as ReturnType<typeof vi.fn>).mockResolvedValue({
      effectiveTabName: 'group-chat',
      projectPath: undefined,
      confirmationMessage: undefined,
    });

    const result = await processInboundMessage(
      makeOpts({ text: '/tab research do something', overrideTabName: 'group-chat' })
    );

    expect(result.tabName).toBe('group-chat');
  });

  it('should return empty response for empty text with no media', async () => {
    const result = await processInboundMessage(makeOpts({ text: '' }));

    expect(result.responseText).toBe('');
    expect(result.isError).toBe(false);
  });

  it('should not crash when TTS provider fails', async () => {
    const ttsProvider: TTSProvider = {
      synthesize: vi.fn().mockRejectedValue(new Error('TTS service unavailable')),
    } as unknown as TTSProvider;

    const result = await processInboundMessage(
      makeOpts({ ttsProvider, voiceReplyMode: 'voice' })
    );

    expect(result.responseText).toBe('Hello from Claude');
    expect(result.audioPath).toBeUndefined();
    expect(result.voiceOnly).toBeFalsy();
  });

  it('should set audioPath and voiceOnly when TTS succeeds with voice mode', async () => {
    const ttsProvider: TTSProvider = {
      synthesize: vi.fn().mockResolvedValue('/tmp/audio.mp3'),
    } as unknown as TTSProvider;

    const result = await processInboundMessage(
      makeOpts({ ttsProvider, voiceReplyMode: 'voice' })
    );

    expect(result.audioPath).toBe('/tmp/audio.mp3');
    expect(result.voiceOnly).toBe(true);
  });

  it('should set audioPath but not voiceOnly in "both" mode', async () => {
    const ttsProvider: TTSProvider = {
      synthesize: vi.fn().mockResolvedValue('/tmp/audio.mp3'),
    } as unknown as TTSProvider;

    const result = await processInboundMessage(
      makeOpts({ ttsProvider, voiceReplyMode: 'both' })
    );

    expect(result.audioPath).toBe('/tmp/audio.mp3');
    expect(result.voiceOnly).toBe(false);
  });

  it('should return confirmation message when route provides one', async () => {
    const { resolveProjectRoute } = await import('../../src/channels/command-handler.js');
    (resolveProjectRoute as ReturnType<typeof vi.fn>).mockResolvedValue({
      effectiveTabName: 'default',
      projectPath: undefined,
      confirmationMessage: 'Switched to project X',
    });

    const result = await processInboundMessage(makeOpts({ text: '/use projectX' }));

    expect(result.responseText).toBe('Switched to project X');
    expect(result.isError).toBe(false);
  });

  it('should pass onTextChunk callback through to sendMessage', async () => {
    const { resolveProjectRoute } = await import('../../src/channels/command-handler.js');
    (resolveProjectRoute as ReturnType<typeof vi.fn>).mockResolvedValue({
      effectiveTabName: 'default',
      projectPath: undefined,
      confirmationMessage: undefined,
    });

    const onTextChunk = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({ text: 'streamed', error: false });
    const tabManager = { sendMessage } as unknown as TabManager;

    await processInboundMessage(makeOpts({ tabManager, onTextChunk }));

    expect(sendMessage).toHaveBeenCalledWith(
      'default',
      'hello world',
      expect.objectContaining({ onTextChunk })
    );
  });
});
