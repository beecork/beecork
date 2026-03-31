import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs';
import path from 'node:path';
import { chunkText, timeAgo, parseTabMessage, buildMediaPrompt } from '../util/text.js';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { getAdminUserId } from '../config.js';
import { getLogsDir } from '../util/paths.js';
import { saveMedia, isOversized } from '../media/store.js';
import { inboundLimiter, groupLimiter } from '../util/rate-limiter.js';
import { ProgressTracker } from '../util/progress.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';
import type { GroupConfig } from '../types.js';
import { initVoiceProviders } from '../voice/index.js';
import type { STTProvider } from '../voice/stt.js';
import type { TTSProvider } from '../voice/tts.js';

const DEFAULT_GROUP_CONFIG: GroupConfig = { activationMode: 'mention', maxResponsesPerMinute: 3, tabPerGroup: true };

/** Format tab status for Telegram display */
export function formatTabStatus(tabs: Array<{ name: string; status: string; lastActivityAt: string }>): string {
  if (tabs.length === 0) return 'No tabs.';
  return tabs.map(t => {
    const ago = timeAgo(t.lastActivityAt);
    return `• ${t.name} [${t.status}] — ${ago}`;
  }).join('\n');
}

export class TelegramChannel implements Channel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  readonly maxMessageLength = 4096;
  readonly supportsStreaming = true;
  readonly supportsMedia = true;

  private bot: TelegramBot;
  private ctx: ChannelContext;
  private activeChatIds: Set<number> = new Set();
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;
  private botUserId: number | null = null;
  private botUsername: string | null = null;
  private mutedGroups = new Set<number>();
  private welcomeSent = new Set<number>();
  private sttWarmedUp = false;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.bot = new TelegramBot(ctx.config.telegram.token, {
      polling: {
        params: {
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        },
        autoStart: false,
      },
    });
    this.bot.sendMessage = this.bot.sendMessage.bind(this.bot);
  }

  async start(): Promise<void> {
    // Clear pending updates from old sessions, then start polling
    try {
      await (this.bot as any).deleteWebHook({ drop_pending_updates: true });
    } catch (err) {
      logger.error('Failed to clear pending updates, starting anyway:', err);
    }
    // Initialize voice providers
    const { stt, tts } = initVoiceProviders(this.ctx.config.voice);
    this.sttProvider = stt;
    this.ttsProvider = tts;

    this.bot.startPolling();

    // Cache bot identity for group mention detection
    try {
      const me = await this.bot.getMe();
      this.botUserId = me.id;
      this.botUsername = me.username ?? null;
    } catch (err) {
      logger.warn('Failed to fetch bot identity (group mentions may not work):', err);
    }

    this.setupHandlers();
    logger.info('Telegram bot started (polling mode, cleared pending updates)');
  }

  stop(): void {
    this.bot.stopPolling();
    logger.info('Telegram bot stopped');
  }

  async sendMessage(peerId: string, text: string, options?: SendOptions): Promise<void> {
    const chatId = Number(peerId);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      await this.sendWithRetry(chatId, chunk);
    }
  }

  async sendNotification(message: string, _urgent?: boolean): Promise<void> {
    for (const chatId of this.activeChatIds) {
      try {
        await this.bot.sendMessage(chatId, message);
      } catch (err) {
        logger.error(`Failed to send notification to chat ${chatId}:`, err);
      }
    }

    for (const userId of this.ctx.config.telegram.allowedUserIds) {
      if (this.activeChatIds.has(userId)) continue;
      try {
        await this.bot.sendMessage(userId, message);
        this.activeChatIds.add(userId);
      } catch { /* User hasn't started conversation yet */ }
    }
  }

  async setTyping(peerId: string, active: boolean): Promise<void> {
    if (active) {
      await this.bot.sendChatAction(Number(peerId), 'typing').catch((err) => {
        logger.error(`Typing indicator failed for chat ${peerId}:`, err);
      });
    }
  }

  onMessage(_handler: InboundMessageHandler): void {
    // Messages are handled directly in setupHandlers()
  }

  // ─── Private ───

  private setupHandlers(): void {
    this.bot.on('message', async (msg) => {
      if (!this.isAllowed(msg.from?.id)) return;

      const chatId = msg.chat.id;

      // Rate limit check
      if (!inboundLimiter.check(this.id)) {
        await this.bot.sendMessage(chatId, "I'm receiving too many messages right now. Please wait a moment.");
        return;
      }

      const isGroup = msg.chat.type === 'group' || msg.chat.type === 'supergroup';

      // First-run welcome message (once per user)
      if (msg.chat.type === 'private' && !this.welcomeSent.has(chatId)) {
        const db = (await import('../db/index.js')).getDb();
        const hasMessages = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
        if (hasMessages.c === 0) {
          this.welcomeSent.add(chatId);
          const welcomeText = msg.text?.trim() || '';
          await this.bot.sendMessage(chatId, [
            '\uD83D\uDC4B Welcome to Beecork!\n',
            'Send any message and I\'ll pass it to Claude Code.',
            '',
            'Quick tips:',
            '\u2022 `/tab name message` \u2014 organize work into tabs',
            '\u2022 `/tabs` \u2014 see what\'s running',
            '\u2022 `/stop name` \u2014 stop a tab',
            '',
            'Let\'s get started! Send me something.',
          ].join('\n'));
          // Don't return - let the actual message be processed too (unless it was just /start)
          if (welcomeText === '/start') return;
        } else {
          this.welcomeSent.add(chatId);
        }
      }

      // Only add to activeChatIds for private chats
      if (!isGroup) {
        this.activeChatIds.add(chatId);
      }

      // Extract text (from text, caption, etc.)
      let text = msg.text?.trim() || msg.caption?.trim() || '';

      // ─── Group activation logic ───
      if (isGroup) {
        // Check muted status
        if (this.mutedGroups.has(chatId)) return;

        const groupConfig = this.ctx.config.groups || DEFAULT_GROUP_CONFIG;

        const isMentioned = this.botUsername ? text.includes(`@${this.botUsername}`) : false;
        const isReplyToBot = msg.reply_to_message?.from?.id === this.botUserId;

        let shouldActivate = false;
        switch (groupConfig.activationMode) {
          case 'mention': shouldActivate = !!isMentioned; break;
          case 'reply': shouldActivate = !!isReplyToBot; break;
          case 'keyword': shouldActivate = groupConfig.keywords?.some(kw => text.toLowerCase().includes(kw.toLowerCase())) ?? false; break;
          case 'always': shouldActivate = true; break;
        }

        if (!shouldActivate) return;

        // Group rate limiting
        const groupKey = `group:${chatId}`;
        if (!groupLimiter.check(groupKey)) {
          // Silently ignore — don't spam the group with rate limit messages
          return;
        }

        // Clean mention from text
        if (isMentioned && this.botUsername) {
          text = text.replace(new RegExp(`@${this.botUsername}`, 'gi'), '').trim();
        }
      }

      // Track voice pipeline timing
      const voicePipelineStart = msg.voice ? Date.now() : null;

      // Download media if present (in parallel)
      const downloadTasks: Array<Promise<MediaAttachment | null>> = [];
      if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        downloadTasks.push(
          this.downloadTelegramFile(photo.file_id, 'jpg')
            .then(fp => fp ? { type: 'image' as const, mimeType: 'image/jpeg', filePath: fp, fileName: `photo-${photo.file_id}.jpg` } : null)
            .catch(() => null)
        );
      }
      if (msg.voice) {
        downloadTasks.push(
          this.downloadTelegramFile(msg.voice.file_id, 'ogg')
            .then(fp => fp ? { type: 'voice' as const, mimeType: 'audio/ogg', filePath: fp, duration: msg.voice!.duration } : null)
            .catch(() => null)
        );
      }
      if (msg.audio) {
        downloadTasks.push(
          this.downloadTelegramFile(msg.audio.file_id, 'mp3')
            .then(fp => fp ? { type: 'audio' as const, mimeType: msg.audio!.mime_type || 'audio/mpeg', filePath: fp, fileName: msg.audio!.title, duration: msg.audio!.duration } : null)
            .catch(() => null)
        );
      }
      if (msg.document) {
        const ext = msg.document.file_name?.split('.').pop() || 'bin';
        downloadTasks.push(
          this.downloadTelegramFile(msg.document.file_id, ext)
            .then(fp => fp ? { type: 'document' as const, mimeType: msg.document!.mime_type || 'application/octet-stream', filePath: fp, fileName: msg.document!.file_name } : null)
            .catch(() => null)
        );
      }
      if (msg.video) {
        downloadTasks.push(
          this.downloadTelegramFile(msg.video.file_id, 'mp4')
            .then(fp => fp ? { type: 'video' as const, mimeType: msg.video!.mime_type || 'video/mp4', filePath: fp, duration: msg.video!.duration } : null)
            .catch(() => null)
        );
      }
      const downloadResults = await Promise.allSettled(downloadTasks);
      const media: MediaAttachment[] = downloadResults
        .filter((r): r is PromiseFulfilledResult<MediaAttachment | null> => r.status === 'fulfilled' && r.value !== null)
        .map(r => r.value!);

      // Warm up STT connection on first voice message
      if (this.sttProvider && !this.sttWarmedUp) {
        this.sttProvider.warmup?.();
        this.sttWarmedUp = true;
      }

      // Transcribe voice messages if STT is configured
      if (this.sttProvider) {
        for (const m of media) {
          if (m.type === 'voice' && m.filePath) {
            const voiceStartTime = Date.now();
            try {
              const transcription = await this.sttProvider.transcribe(m.filePath);
              m.caption = `[Transcribed from voice message]: ${transcription}`;
              logger.info(`[telegram] Voice transcription: ${Date.now() - voiceStartTime}ms`);
            } catch (err) {
              logger.warn('Voice transcription failed, passing file path instead:', err);
            }
          }
        }
      }

      // Skip if no text AND no media
      if (!text && media.length === 0) return;

      try {
        // Commands bypass debouncing (only if pure text, no media)
        if (text.startsWith('/') && media.length === 0) {
          await this.handleCommand(chatId, text, msg.from?.id, msg.message_id, isGroup);
          return;
        }

        // Send typing indicator immediately
        this.bot.sendChatAction(chatId, 'typing').catch((err) => {
          logger.error(`Typing indicator failed for chat ${chatId}:`, err);
        });
        logger.info(`[telegram] Message received from ${msg.from?.id}, sending typing`);

        await this.handleMessage(chatId, text, msg.message_id, media, isGroup);
        if (voicePipelineStart) {
          logger.info(`[telegram] Voice-to-response total: ${Date.now() - voicePipelineStart}ms`);
        }
      } catch (err) {
        logger.error('Telegram: error handling message:', err);
        await this.bot.sendMessage(chatId, 'Something went wrong processing your message. Check daemon logs for details.');
      }
    });
  }

  private async handleCommand(chatId: number, text: string, userId: number | undefined, messageId: number, isGroup = false): Promise<void> {
    // Telegram-only group commands
    if (text === '/mute' && isGroup) {
      this.mutedGroups.add(chatId);
      await this.bot.sendMessage(chatId, 'Beecork muted in this group. Use /unmute to re-enable.');
      return;
    }
    if (text === '/unmute' && isGroup) {
      this.mutedGroups.delete(chatId);
      await this.bot.sendMessage(chatId, 'Beecork unmuted in this group.');
      return;
    }

    if (text === '/history' || text.startsWith('/history ')) {
      const dateArg = text.slice(9).trim();
      const { getTimeline, formatTimeline } = await import('../timeline/index.js');
      let date: string;
      if (dateArg === 'yesterday') {
        date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      } else if (dateArg) {
        date = dateArg;
      } else {
        date = new Date().toISOString().slice(0, 10);
      }
      const events = getTimeline({ date, limit: 30 });
      await this.sendResponse(chatId, formatTimeline(events));
      return;
    }

    if (text === '/knowledge') {
      const { getAllKnowledge, formatKnowledgeForContext } = await import('../knowledge/index.js');
      const entries = getAllKnowledge();
      if (entries.length === 0) {
        await this.bot.sendMessage(chatId, 'No knowledge stored yet. Beecork learns from your conversations.');
        return;
      }
      const formatted = formatKnowledgeForContext(entries);
      await this.sendResponse(chatId, formatted.slice(0, 4000));
      return;
    }

    // Shared command handler (covers /tabs, /stop, /tab, /projects, /project, /newproject, /close, /fresh, /register, /link, /users, /cost, /activity, /handoff, /machines)
    const { handleSharedCommand } = await import('./command-handler.js');
    const result = await handleSharedCommand({
      userId: String(userId || 'default'),
      text,
      isAdmin: this.isAdmin(userId),
      channelId: 'telegram',
    }, this.ctx.tabManager);

    if (result.handled) {
      if (result.response) await this.bot.sendMessage(chatId, result.response);
      return;
    }

    // /tab with valid name — falls through from shared handler, treat as message
    if (text.startsWith('/tab ')) {
      await this.handleMessage(chatId, text, messageId);
      return;
    }

    // Unknown command — treat as regular message
    await this.handleMessage(chatId, text, messageId);
  }

  private async handleMessage(chatId: number, text: string, messageId: number, media: MediaAttachment[] = [], isGroup = false): Promise<void> {
    let { tabName, prompt: rawPrompt } = parseTabMessage(text);
    if (!rawPrompt && media.length === 0) return;

    // Group tab routing: use a dedicated tab per group unless /tab is explicit
    if (isGroup) {
      const groupConfig = this.ctx.config.groups || DEFAULT_GROUP_CONFIG;
      if (groupConfig.tabPerGroup && !text.startsWith('/tab ')) {
        tabName = `group-tg-${Math.abs(chatId)}`;
      }
    }

    // Smart project routing (shared across all channels)
    const { resolveProjectRoute } = await import('./command-handler.js');
    const route = await resolveProjectRoute(rawPrompt, tabName, text, String(chatId));
    if (route.confirmationMessage) {
      await this.bot.sendMessage(chatId, route.confirmationMessage);
      return;
    }
    let effectiveTabName = route.effectiveTabName;
    let projectPath = route.projectPath;

    // Build prompt with media references
    const prompt = buildMediaPrompt(media, rawPrompt);

    logger.info(`[telegram] Handling message for tab "${effectiveTabName}" (chat: ${chatId}, msg: ${messageId})`);

    // React with ⏳
    await this.setReaction(chatId, messageId, '⏳');

    // Typing indicator — keep refreshing every 4s
    const sendTyping = () => this.bot.sendChatAction(chatId, 'typing').catch((err) => {
      logger.error(`Typing indicator failed:`, err);
    });
    await sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    // "Still working" timeout
    const stillWorkingTimeout = setTimeout(() => {
      this.bot.sendMessage(chatId, `Still working on your request in tab "${effectiveTabName}"...`).catch(() => {});
    }, 120000);

    try {
      let responseText: string;
      let responseError: boolean;
      let responseTab = effectiveTabName;

      if (this.ctx.pipeBrain) {
        const pipeResult = await this.ctx.pipeBrain.process(text, { chatId, userId: 0, messageId });
        responseText = pipeResult.response.text || '(empty response)';
        responseError = pipeResult.response.error;
        responseTab = pipeResult.tabName;

        if (pipeResult.decisions.length > 0) {
          const decisionText = pipeResult.decisions.join('\n');
          await this.bot.sendMessage(chatId, decisionText);
        }
      } else {
        let streamMsgId: number | null = null;
        let streamBuffer = '';
        let lastEditTime = 0;

        const onTextChunk = async (chunk: string) => {
          streamBuffer += chunk;
          const now = Date.now();
          if (streamBuffer.length < 100 || now - lastEditTime < 1000) return;
          lastEditTime = now;
          try {
            const prefix = effectiveTabName !== 'default' ? `[${effectiveTabName}] ` : '';
            const preview = prefix + streamBuffer.slice(0, 4000) + (streamBuffer.length > 4000 ? '...' : '');
            if (!streamMsgId) {
              const sent = await this.bot.sendMessage(chatId, preview);
              streamMsgId = sent.message_id;
            } else {
              await this.bot.editMessageText(preview, { chat_id: chatId, message_id: streamMsgId });
            }
          } catch { /* edit failures are non-critical */ }
        };

        // Progress updates for long tasks (every 30 seconds)
        const progressTracker = new ProgressTracker(effectiveTabName, (msg) => {
          this.bot.sendMessage(chatId, msg).catch(() => {});
        });

        const result = await this.ctx.tabManager.sendMessage(effectiveTabName, prompt, {
          onTextChunk,
          onToolUse: (name, input) => progressTracker.record(name, input),
          projectPath,
        });
        progressTracker.stop();
        responseText = result.text || '(empty response)';
        responseError = result.error;

        if (streamMsgId && !responseError) {
          clearInterval(typingInterval);
          clearTimeout(stillWorkingTimeout);
          await this.setReaction(chatId, messageId, '✅');
          try {
            const prefix = effectiveTabName !== 'default' ? `[${effectiveTabName}] ` : '';
            const finalText = prefix + responseText;
            if (finalText.length <= 4096) {
              await this.bot.editMessageText(finalText, { chat_id: chatId, message_id: streamMsgId });
            } else {
              await this.sendResponse(chatId, responseText, effectiveTabName);
            }
          } catch {
            await this.sendResponse(chatId, responseText, effectiveTabName);
          }
          return;
        }
      }

      clearInterval(typingInterval);
      clearTimeout(stillWorkingTimeout);

      if (responseError) {
        await this.setReaction(chatId, messageId, '❌');
        await this.sendResponse(chatId, `Error: ${responseText}`, responseTab);
        return;
      }

      await this.setReaction(chatId, messageId, '✅');

      // TTS: send voice reply if configured
      const voiceReplyMode = this.ctx.config.voice?.replyMode;
      if (this.ttsProvider && (voiceReplyMode === 'voice' || voiceReplyMode === 'both')) {
        try {
          const audioPath = await this.ttsProvider.synthesize(responseText);
          await this.bot.sendVoice(chatId, audioPath);
          if (voiceReplyMode === 'voice') return; // Don't send text
        } catch (err) {
          logger.warn('TTS failed, sending text reply:', err);
        }
      }

      await this.sendResponse(chatId, responseText, responseTab);
    } catch (err) {
      clearInterval(typingInterval);
      clearTimeout(stillWorkingTimeout);
      await this.setReaction(chatId, messageId, '❌');
      throw err;
    }
  }

  private async sendResponse(chatId: number, text: string, tabName?: string): Promise<void> {
    const prefix = tabName && tabName !== 'default' ? `[${tabName}] ` : '';
    const fullText = prefix + text;
    const chunks = chunkText(fullText);

    if (chunks.length > 10) {
      for (let i = 0; i < 3; i++) {
        await this.sendWithRetry(chatId, chunks[i]);
      }
      const tmpPath = path.join(getLogsDir(), `response-${Date.now()}.txt`);
      fs.writeFileSync(tmpPath, fullText);
      await this.bot.sendDocument(chatId, tmpPath, { caption: `Full response (${chunks.length} chunks)` });
      fs.unlinkSync(tmpPath);
      return;
    }

    for (const chunk of chunks) {
      await this.sendWithRetry(chatId, chunk);
    }
  }

  private async sendWithRetry(chatId: number, text: string): Promise<void> {
    try {
      await retryWithBackoff(
        async () => {
          try {
            await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
          } catch {
            await this.bot.sendMessage(chatId, text);
          }
        },
        [1000, 5000, 15000],
        'telegram-send',
      );
    } catch (err) {
      const failLog = path.join(getLogsDir(), 'delivery-failures.log');
      const entry = `[${new Date().toISOString()}] chatId=${chatId} error=${err instanceof Error ? err.message : err} text=${text.slice(0, 200)}\n`;
      fs.appendFileSync(failLog, entry);
      logger.error(`Delivery failed after retries for chat ${chatId}`);
    }
  }

  private async downloadTelegramFile(fileId: string, extension: string): Promise<string | null> {
    const fileInfo = await this.bot.getFile(fileId);
    if (!fileInfo.file_path) return null;

    // Check file size (Telegram provides file_size in bytes)
    if (fileInfo.file_size && isOversized(fileInfo.file_size)) {
      logger.warn(`Skipping oversized file: ${fileInfo.file_size} bytes`);
      return null;
    }

    const url = `https://api.telegram.org/file/bot${this.ctx.config.telegram.token}/${fileInfo.file_path}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    return saveMedia(buffer, extension, fileInfo.file_path.split('/').pop());
  }

  private isAllowed(userId: number | undefined): boolean {
    if (!userId) return false;
    return this.ctx.config.telegram.allowedUserIds.includes(userId);
  }

  private isAdmin(userId: number | undefined): boolean {
    if (!userId) return false;
    return userId === getAdminUserId();
  }

  private async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.ctx.config.telegram.token}/setMessageReaction`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: 'emoji', emoji }],
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Reactions not supported or failed — non-critical
    }
  }
}
