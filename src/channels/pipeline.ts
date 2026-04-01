/**
 * Shared message-processing pipeline for all channels.
 *
 * Handles the common flow: project routing -> media prompt building ->
 * tab message sending -> progress tracking -> TTS voice reply.
 *
 * Each channel remains responsible for:
 *   - Platform-specific message parsing and media download
 *   - Typing indicators (passed as a callback)
 *   - Sending the final response via its own API
 *   - Any channel-specific features (Telegram streaming, Discord threads, etc.)
 */
import { parseTabMessage, buildMediaPrompt } from '../util/text.js';
import { ProgressTracker } from '../util/progress.js';
import { logger } from '../util/logger.js';
import type { MediaAttachment } from './types.js';
import type { TabManager } from '../session/manager.js';
import type { TTSProvider } from '../voice/tts.js';

export interface PipelineOptions {
  /** Raw message text (may include /tab prefix) */
  text: string;
  /** Downloaded media attachments */
  media: MediaAttachment[];
  /** Channel identifier for logging */
  channelId: string;
  /** Tab manager instance */
  tabManager: TabManager;
  /** Voice reply mode from config */
  voiceReplyMode?: 'voice' | 'both' | 'text';
  /** TTS provider (if configured) */
  ttsProvider?: TTSProvider | null;
  /** User ID for project routing */
  userId: string;
  /** Callback to send progress messages to the user */
  sendProgress: (message: string) => void;
  /**
   * Override the tab name (e.g., group tabs in Telegram, thread tabs in Discord).
   * When set, parseTabMessage result is ignored for the tab name.
   */
  overrideTabName?: string;
  /**
   * Callback invoked on each text chunk from Claude (for streaming).
   * Only Telegram uses this currently.
   */
  onTextChunk?: (chunk: string) => void;
}

export interface PipelineResult {
  /** The final response text (already includes "Error: " prefix on errors) */
  responseText: string;
  /** The tab name that was actually used */
  tabName: string;
  /** Whether the response was an error */
  isError: boolean;
  /** Path to TTS audio file, if voice reply was generated */
  audioPath?: string;
  /** Whether voice-only mode is active (caller should skip text response) */
  voiceOnly?: boolean;
}

/**
 * Process an inbound message through the shared pipeline.
 *
 * Returns the response text and optional audio path. The caller (channel)
 * is responsible for delivering the response using its platform API.
 */
export async function processInboundMessage(opts: PipelineOptions): Promise<PipelineResult> {
  const {
    text,
    media,
    channelId,
    tabManager,
    voiceReplyMode,
    ttsProvider,
    userId,
    sendProgress,
    overrideTabName,
    onTextChunk,
  } = opts;

  // 1. Parse tab name and prompt from the message text
  let { tabName, prompt: rawPrompt } = parseTabMessage(text);

  // Allow channel to override tab name (group tabs, thread tabs, etc.)
  if (overrideTabName) {
    tabName = overrideTabName;
  }

  if (!rawPrompt && media.length === 0) {
    return { responseText: '', tabName, isError: false };
  }

  // 2. Smart project routing
  const { resolveProjectRoute } = await import('./command-handler.js');
  const route = await resolveProjectRoute(rawPrompt, tabName, text, userId);

  if (route.confirmationMessage) {
    return {
      responseText: route.confirmationMessage,
      tabName,
      isError: false,
    };
  }

  const effectiveTabName = route.effectiveTabName;
  const projectPath = route.projectPath;

  // 3. Build prompt with media references
  const prompt = buildMediaPrompt(media, rawPrompt);

  logger.info(`[${channelId}] Pipeline processing for tab "${effectiveTabName}"`);

  // 4. Create progress tracker
  const progressTracker = new ProgressTracker(effectiveTabName, sendProgress);

  // 5. Send message to tab
  const result = await tabManager.sendMessage(effectiveTabName, prompt, {
    onTextChunk,
    onToolUse: (name, input) => progressTracker.record(name, input),
    projectPath,
  });
  progressTracker.stop();

  // 6. Build response text
  const isError = result.error;
  const responseText = isError
    ? `Error: ${result.text}`
    : result.text || '(empty response)';

  // 7. TTS voice reply (shared logic)
  let audioPath: string | undefined;
  let voiceOnly = false;

  if (ttsProvider && (voiceReplyMode === 'voice' || voiceReplyMode === 'both')) {
    try {
      audioPath = await ttsProvider.synthesize(responseText);
      if (voiceReplyMode === 'voice') {
        voiceOnly = true;
      }
    } catch (err) {
      logger.warn(`[${channelId}] TTS failed, falling back to text:`, err);
    }
  }

  return {
    responseText,
    tabName: effectiveTabName,
    isError,
    audioPath,
    voiceOnly,
  };
}
