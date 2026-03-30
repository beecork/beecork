import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs';
import path from 'node:path';
import { chunkText, timeAgo, parseTabMessage } from '../util/text.js';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { getAdminUserId, validateTabName } from '../config.js';
import { getLogsDir } from '../util/paths.js';
import { saveMedia, isOversized } from '../media/store.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';

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
  private messageHandler: InboundMessageHandler | null = null;

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
      await fetch(
        `https://api.telegram.org/bot${this.ctx.config.telegram.token}/deleteWebhook?drop_pending_updates=true`,
        { signal: AbortSignal.timeout(10000) },
      );
    } catch (err) {
      logger.error('Failed to clear pending updates, starting anyway:', err);
    }
    this.bot.startPolling();
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

  onMessage(handler: InboundMessageHandler): void {
    this.messageHandler = handler;
  }

  // ─── Private ───

  private setupHandlers(): void {
    this.bot.on('message', async (msg) => {
      if (!this.isAllowed(msg.from?.id)) return;

      const chatId = msg.chat.id;
      if (msg.chat.type === 'private') {
        this.activeChatIds.add(chatId);
      }
      // Extract text (from text, caption, etc.)
      const text = msg.text?.trim() || msg.caption?.trim() || '';

      // Download media if present
      const media: MediaAttachment[] = [];
      if (msg.photo) {
        // Get largest photo
        const photo = msg.photo[msg.photo.length - 1];
        try {
          const filePath = await this.downloadTelegramFile(photo.file_id, 'jpg');
          if (filePath) media.push({ type: 'image', mimeType: 'image/jpeg', filePath, fileName: `photo-${photo.file_id}.jpg` });
        } catch (err) { logger.warn('Failed to download photo:', err); }
      }
      if (msg.voice) {
        try {
          const filePath = await this.downloadTelegramFile(msg.voice.file_id, 'ogg');
          if (filePath) media.push({ type: 'voice', mimeType: 'audio/ogg', filePath, duration: msg.voice.duration });
        } catch (err) { logger.warn('Failed to download voice:', err); }
      }
      if (msg.audio) {
        try {
          const filePath = await this.downloadTelegramFile(msg.audio.file_id, 'mp3');
          if (filePath) media.push({ type: 'audio', mimeType: msg.audio.mime_type || 'audio/mpeg', filePath, fileName: msg.audio.title, duration: msg.audio.duration });
        } catch (err) { logger.warn('Failed to download audio:', err); }
      }
      if (msg.document) {
        try {
          const ext = msg.document.file_name?.split('.').pop() || 'bin';
          const filePath = await this.downloadTelegramFile(msg.document.file_id, ext);
          if (filePath) media.push({ type: 'document', mimeType: msg.document.mime_type || 'application/octet-stream', filePath, fileName: msg.document.file_name });
        } catch (err) { logger.warn('Failed to download document:', err); }
      }
      if (msg.video) {
        try {
          const filePath = await this.downloadTelegramFile(msg.video.file_id, 'mp4');
          if (filePath) media.push({ type: 'video', mimeType: msg.video.mime_type || 'video/mp4', filePath, duration: msg.video.duration });
        } catch (err) { logger.warn('Failed to download video:', err); }
      }

      // Skip if no text AND no media
      if (!text && media.length === 0) return;

      try {
        // Commands bypass debouncing (only if pure text, no media)
        if (text.startsWith('/') && media.length === 0) {
          await this.handleCommand(chatId, text, msg.from?.id, msg.message_id);
          return;
        }

        // Send typing indicator immediately
        this.bot.sendChatAction(chatId, 'typing').catch((err) => {
          logger.error(`Typing indicator failed for chat ${chatId}:`, err);
        });
        logger.info(`[telegram] Message received from ${msg.from?.id}, sending typing`);

        await this.handleMessage(chatId, text, msg.message_id, media);
      } catch (err) {
        logger.error('Telegram: error handling message:', err);
        await this.bot.sendMessage(chatId, 'Something went wrong processing your message. Check daemon logs for details.');
      }
    });
  }

  private async handleCommand(chatId: number, text: string, userId: number | undefined, messageId: number): Promise<void> {
    if (text === '/tabs' || text.startsWith('/tabs@')) {
      const tabs = this.ctx.tabManager.listTabs();
      const formatted = formatTabStatus(tabs);
      await this.bot.sendMessage(chatId, formatted);
      return;
    }

    if (text.startsWith('/stop ')) {
      if (!this.isAdmin(userId)) {
        await this.bot.sendMessage(chatId, 'Only admin can stop tabs.');
        return;
      }
      const tabName = text.slice(6).trim();
      this.ctx.tabManager.stopTab(tabName);
      await this.bot.sendMessage(chatId, `Stopped tab: ${tabName}`);
      return;
    }

    if (text.startsWith('/tab ')) {
      const rest = text.slice(5);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) {
        await this.bot.sendMessage(chatId, `Usage: /tab <name> <message>`);
        return;
      }
      const tabName = rest.slice(0, spaceIdx);
      const validationError = validateTabName(tabName);
      if (validationError) {
        await this.bot.sendMessage(chatId, `Invalid tab name: ${validationError}`);
        return;
      }
      await this.handleMessage(chatId, text, messageId);
      return;
    }

    // Unknown command — treat as regular message
    await this.handleMessage(chatId, text, messageId);
  }

  private async handleMessage(chatId: number, text: string, messageId: number, media: MediaAttachment[] = []): Promise<void> {
    const { tabName, prompt: rawPrompt } = parseTabMessage(text);
    if (!rawPrompt && media.length === 0) return;

    // Build prompt with media references
    let prompt = rawPrompt;
    if (media.length > 0) {
      const mediaDescriptions = media.map(m => {
        switch (m.type) {
          case 'image': return `User sent an image: ${m.filePath}`;
          case 'voice': return `User sent a voice message: ${m.filePath}`;
          case 'audio': return `User sent an audio file: ${m.filePath}${m.fileName ? ` (${m.fileName})` : ''}`;
          case 'video': return `User sent a video: ${m.filePath}`;
          case 'document': return `User sent a file: ${m.filePath}${m.fileName ? ` (${m.fileName})` : ''}`;
          default: return `User sent a file: ${m.filePath}`;
        }
      });
      const mediaText = mediaDescriptions.join('\n');
      prompt = prompt ? `${mediaText}\n\n${prompt}` : mediaText;
    }

    logger.info(`[telegram] Handling message for tab "${tabName}" (chat: ${chatId}, msg: ${messageId})`);

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
      this.bot.sendMessage(chatId, `Still working on your request in tab "${tabName}"...`).catch(() => {});
    }, 120000);

    try {
      let responseText: string;
      let responseError: boolean;
      let responseTab = tabName;

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
            const prefix = tabName !== 'default' ? `[${tabName}] ` : '';
            const preview = prefix + streamBuffer.slice(0, 4000) + (streamBuffer.length > 4000 ? '...' : '');
            if (!streamMsgId) {
              const sent = await this.bot.sendMessage(chatId, preview);
              streamMsgId = sent.message_id;
            } else {
              await this.bot.editMessageText(preview, { chat_id: chatId, message_id: streamMsgId });
            }
          } catch { /* edit failures are non-critical */ }
        };

        const result = await this.ctx.tabManager.sendMessage(tabName, prompt, { onTextChunk });
        responseText = result.text || '(empty response)';
        responseError = result.error;

        if (streamMsgId && !responseError) {
          clearInterval(typingInterval);
          clearTimeout(stillWorkingTimeout);
          await this.setReaction(chatId, messageId, '✅');
          try {
            const prefix = tabName !== 'default' ? `[${tabName}] ` : '';
            const finalText = prefix + responseText;
            if (finalText.length <= 4096) {
              await this.bot.editMessageText(finalText, { chat_id: chatId, message_id: streamMsgId });
            } else {
              await this.sendResponse(chatId, responseText, tabName);
            }
          } catch {
            await this.sendResponse(chatId, responseText, tabName);
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
