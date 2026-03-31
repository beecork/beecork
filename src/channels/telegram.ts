import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs';
import path from 'node:path';
import { chunkText, timeAgo, parseTabMessage } from '../util/text.js';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { getAdminUserId, validateTabName } from '../config.js';
import { getLogsDir } from '../util/paths.js';
import { saveMedia, isOversized } from '../media/store.js';
import { inboundLimiter, groupLimiter } from '../util/rate-limiter.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';
import { createSTTProvider, type STTProvider } from '../voice/stt.js';
import { createTTSProvider, type TTSProvider } from '../voice/tts.js';

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
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;
  private botUserId: number | null = null;
  private botUsername: string | null = null;
  private mutedGroups = new Set<number>();
  private welcomeSent = new Set<number>();

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
    // Initialize voice providers
    if (this.ctx.config.voice?.sttProvider && this.ctx.config.voice.sttProvider !== 'none') {
      this.sttProvider = createSTTProvider({ provider: this.ctx.config.voice.sttProvider, apiKey: this.ctx.config.voice.sttApiKey });
    }
    if (this.ctx.config.voice?.ttsProvider && this.ctx.config.voice.ttsProvider !== 'none') {
      this.ttsProvider = createTTSProvider({ provider: this.ctx.config.voice.ttsProvider, apiKey: this.ctx.config.voice.ttsApiKey, voice: this.ctx.config.voice.ttsVoice });
    }

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

  onMessage(handler: InboundMessageHandler): void {
    this.messageHandler = handler;
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

        const groupConfig = this.ctx.config.groups || { activationMode: 'mention' as const, maxResponsesPerMinute: 3, tabPerGroup: true };

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

      // Transcribe voice messages if STT is configured
      if (this.sttProvider) {
        for (const m of media) {
          if (m.type === 'voice' && m.filePath) {
            try {
              const transcription = await this.sttProvider.transcribe(m.filePath);
              m.caption = `[Transcribed from voice message]: ${transcription}`;
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
      } catch (err) {
        logger.error('Telegram: error handling message:', err);
        await this.bot.sendMessage(chatId, 'Something went wrong processing your message. Check daemon logs for details.');
      }
    });
  }

  private async handleCommand(chatId: number, text: string, userId: number | undefined, messageId: number, isGroup = false): Promise<void> {
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

      // Check for --set-prompt flag: /tab <name> --set-prompt "..."
      const setPromptMatch = rest.match(/^(\S+)\s+--set-prompt\s+"([^"]+)"/);
      if (setPromptMatch) {
        const tabName = setPromptMatch[1];
        const systemPrompt = setPromptMatch[2];
        const { getDb } = await import('../db/index.js');
        const db = getDb();
        db.prepare('UPDATE tabs SET system_prompt = ? WHERE name = ?').run(systemPrompt, tabName);
        await this.bot.sendMessage(chatId, `System prompt updated for tab "${tabName}"`);
        return;
      }

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

    if (text === '/register' || text.startsWith('/register ')) {
      const { resolveUser, registerUser, hasAdmin } = await import('../users/index.js');
      const existing = resolveUser('telegram', String(userId));
      if (existing) {
        await this.bot.sendMessage(chatId, `You're already registered as "${existing.name}" (${existing.role}).`);
        return;
      }
      // First user becomes admin, rest need approval
      const name = text.slice(10).trim() || `user-${userId}`;
      const role = hasAdmin() ? 'user' : 'admin';
      const user = registerUser(name, 'telegram', String(userId), role);
      await this.bot.sendMessage(chatId, `Registered as "${user.name}" (${user.role}).${role === 'admin' ? ' You are the admin.' : ''}`);
      return;
    }

    if (text.startsWith('/link ')) {
      // /link discord:123456789
      const { resolveUser, linkIdentity } = await import('../users/index.js');
      const user = resolveUser('telegram', String(userId));
      if (!user) {
        await this.bot.sendMessage(chatId, 'Register first: /register');
        return;
      }
      const parts = text.slice(6).trim().split(':');
      if (parts.length !== 2) {
        await this.bot.sendMessage(chatId, 'Usage: /link channel:peerId (e.g., /link discord:123456789)');
        return;
      }
      const success = linkIdentity(user.id, parts[0], parts[1]);
      await this.bot.sendMessage(chatId, success ? `Linked ${parts[0]} identity.` : 'Failed to link — already linked or invalid.');
      return;
    }

    if (text === '/users') {
      if (!this.isAdmin(userId)) {
        await this.bot.sendMessage(chatId, 'Admin only.');
        return;
      }
      const { listUsers } = await import('../users/index.js');
      const users = listUsers();
      if (users.length === 0) {
        await this.bot.sendMessage(chatId, 'No registered users.');
        return;
      }
      const list = users.map(u => `• ${u.name} [${u.role}] — ${u.id.slice(0, 8)}`).join('\n');
      await this.bot.sendMessage(chatId, `${users.length} user(s):\n${list}`);
      return;
    }

    if (text === '/cost' || text.startsWith('/cost ')) {
      const { getCostSummary, formatCostSummary } = await import('../observability/analytics.js');
      const summary = getCostSummary();
      await this.bot.sendMessage(chatId, formatCostSummary(summary));
      return;
    }

    if (text === '/activity' || text.startsWith('/activity ')) {
      const hoursStr = text.slice(10).trim();
      const hours = parseInt(hoursStr) || 24;
      const { getActivitySummary, formatActivitySummary } = await import('../observability/analytics.js');
      const summary = getActivitySummary(hours);
      await this.bot.sendMessage(chatId, formatActivitySummary(summary));
      return;
    }

    if (text.startsWith('/handoff')) {
      const tabName = text.slice(9).trim() || 'default';
      const { exportTab, formatHandoffInfo } = await import('../cli/handoff.js');
      const info = exportTab(tabName);
      if (!info) {
        await this.bot.sendMessage(chatId, `Tab "${tabName}" not found.`);
        return;
      }
      await this.bot.sendMessage(chatId, formatHandoffInfo(info));
      return;
    }

    if (text === '/machines' || text.startsWith('/machines@')) {
      const { listMachines } = await import('../machines/index.js');
      const machines = listMachines();
      if (machines.length === 0) {
        await this.bot.sendMessage(chatId, 'No machines registered.');
        return;
      }
      const list = machines.map(m => {
        const primary = m.isPrimary ? ' \u2B50' : '';
        const remote = m.host ? ` (${m.sshUser}@${m.host})` : ' (local)';
        const paths = m.projectPaths.slice(0, 3).join(', ');
        return `\u2022 ${m.name}${primary}${remote}\n  Projects: ${paths}`;
      }).join('\n\n');
      await this.bot.sendMessage(chatId, `\uD83D\uDDA5 ${machines.length} machine(s):\n\n${list}`);
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
      const groupConfig = this.ctx.config.groups || { activationMode: 'mention' as const, maxResponsesPerMinute: 3, tabPerGroup: true };
      if (groupConfig.tabPerGroup && !text.startsWith('/tab ')) {
        tabName = `group-tg-${Math.abs(chatId)}`;
      }
    }

    // Build prompt with media references
    let prompt = rawPrompt;
    if (media.length > 0) {
      const mediaDescriptions = media.map(m => {
        // Use transcription if available (voice messages with STT)
        if (m.type === 'voice' && m.caption?.startsWith('[Transcribed')) {
          return m.caption;
        }
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
