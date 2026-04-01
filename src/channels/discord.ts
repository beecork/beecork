import { logger } from '../util/logger.js';
import { chunkText, parseTabMessage } from '../util/text.js';
import { retryWithBackoff } from '../util/retry.js';
import { inboundLimiter } from '../util/rate-limiter.js';
import { saveMedia, isOversized } from '../media/store.js';
import { initVoiceProviders } from '../voice/index.js';
import type { STTProvider } from '../voice/stt.js';
import type { TTSProvider } from '../voice/tts.js';
import { processInboundMessage } from './pipeline.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';

export class DiscordChannel implements Channel {
  readonly id = 'discord';
  readonly name = 'Discord';
  readonly maxMessageLength = 2000;
  readonly supportsStreaming = false; // Discord message editing is rate-limited
  readonly supportsMedia = true;

  private client: any = null; // Discord.js Client
  private ctx: ChannelContext;
  private allowedUserIds: Set<string>;
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;
  private sttWarmedUp = false;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.allowedUserIds = new Set(
      (ctx.config.discord?.allowedUserIds ?? []).map(String)
    );
  }

  async start(): Promise<void> {
    const discordConfig = this.ctx.config.discord;
    if (!discordConfig?.token) {
      logger.warn('No Discord token configured');
      return;
    }

    // Dynamic import since discord.js might not be installed
    const { Client, GatewayIntentBits, Events } = await import('discord.js');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Voice providers
    const { stt, tts } = initVoiceProviders(this.ctx.config.voice);
    this.sttProvider = stt;
    this.ttsProvider = tts;

    this.client.on(Events.MessageCreate, async (message: any) => {
      // Ignore bot messages
      if (message.author.bot) return;

      const isDM = !message.guild;
      const isMentioned = message.mentions.has(this.client.user);

      // In DMs: only allow users in the allowlist
      // In servers: only respond if @mentioned
      if (isDM) {
        if (!this.allowedUserIds.has(message.author.id)) return;
      } else {
        if (!isMentioned) return;
      }

      // Rate limit
      if (!inboundLimiter.check(this.id)) {
        await message.reply("I'm receiving too many messages right now. Please wait a moment.").catch(() => {});
        return;
      }

      const text = message.content
        .replace(/<@!?\d+>/g, '') // Remove mentions
        .trim();

      // Warm up STT connection on first message with attachments
      if (this.sttProvider && !this.sttWarmedUp && message.attachments.size > 0) {
        this.sttProvider.warmup?.();
        this.sttWarmedUp = true;
      }

      // Download attachments
      const media: MediaAttachment[] = [];
      for (const attachment of message.attachments.values()) {
        try {
          if (isOversized(attachment.size)) {
            logger.warn(`Skipping oversized Discord attachment: ${attachment.size} bytes`);
            continue;
          }
          const response = await fetch(attachment.url, { signal: AbortSignal.timeout(30000) });
          if (!response.ok) continue;
          const buffer = Buffer.from(await response.arrayBuffer());
          const ext = attachment.name?.split('.').pop() || 'bin';
          const filePath = saveMedia(buffer, ext, attachment.name);

          let type: MediaAttachment['type'] = 'document';
          if (attachment.contentType?.startsWith('image/')) type = 'image';
          else if (attachment.contentType?.startsWith('video/')) type = 'video';
          else if (attachment.contentType?.startsWith('audio/')) type = 'audio';

          media.push({
            type,
            mimeType: attachment.contentType || 'application/octet-stream',
            filePath,
            fileName: attachment.name,
          });
        } catch (err) {
          logger.warn('Failed to download Discord attachment:', err);
        }
      }

      if (!text && media.length === 0) return;

      try {
        // Show typing
        await message.channel.sendTyping().catch(() => {});

        // Parse tab name (needed for command handling check)
        const { tabName } = parseTabMessage(text || '');

        // Shared command handler
        if (text.startsWith('/')) {
          const { handleSharedCommand } = await import('./command-handler.js');
          const cmdResult = await handleSharedCommand({
            userId: message.author.id,
            text,
            isAdmin: this.allowedUserIds.size > 0 && message.author.id === [...this.allowedUserIds][0],
            channelId: 'discord',
          }, this.ctx.tabManager);
          if (cmdResult.handled) {
            if (cmdResult.response) await message.reply(cmdResult.response);
            return;
          }
        }

        // Discord-specific: use thread name as tab if in a thread
        let overrideTabName: string | undefined;
        if (message.channel.isThread?.()) {
          const threadName = (message.channel.name || '')
            .replace(/[^a-zA-Z0-9-]/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 32);
          if (threadName && tabName === 'default') overrideTabName = threadName;
        }

        // Typing indicator refresh
        const typingInterval = setInterval(() => {
          message.channel.sendTyping().catch(() => {});
        }, 8000); // Discord typing lasts 10s

        try {
          // Shared message pipeline
          const pipelineResult = await processInboundMessage({
            text: text || '',
            media,
            channelId: 'discord',
            tabManager: this.ctx.tabManager,
            voiceReplyMode: this.ctx.config.voice?.replyMode,
            ttsProvider: this.ttsProvider,
            userId: message.author.id,
            sendProgress: (msg) => {
              message.channel.send(msg).catch(() => {});
            },
            overrideTabName,
          });
          clearInterval(typingInterval);

          // Empty result means no prompt and no media
          if (!pipelineResult.responseText) return;

          // Voice reply if TTS generated audio
          if (pipelineResult.audioPath) {
            await message.reply({ files: [pipelineResult.audioPath] });
            if (pipelineResult.voiceOnly) return;
          }

          // Send text response
          await this.sendResponse(message, pipelineResult.responseText, pipelineResult.tabName);
        } catch (err) {
          clearInterval(typingInterval);
          throw err;
        }
      } catch (err) {
        logger.error('Discord message handler error:', err);
        await message.reply('Something went wrong processing your message.').catch(() => {});
      }
    });

    this.client.on(Events.ClientReady, () => {
      logger.info(`Discord bot ready as ${this.client.user?.tag}`);
    });

    await this.client.login(discordConfig.token);
  }

  stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    logger.info('Discord bot stopped');
  }

  onMessage(_handler: InboundMessageHandler): void {
    // Messages are handled directly in start()
  }

  async sendMessage(peerId: string, text: string, options?: SendOptions): Promise<void> {
    if (!this.client) return;
    try {
      const channel = await this.client.channels.fetch(peerId);
      if (!channel?.isTextBased()) return;

      const chunks = chunkText(text, this.maxMessageLength);
      for (const chunk of chunks) {
        await retryWithBackoff(
          () => channel.send(chunk),
          [1000, 5000, 15000],
          'discord-send',
        );
      }
    } catch (err) {
      logger.error(`Discord send failed for ${peerId}:`, err);
    }
  }

  async sendNotification(message: string, urgent?: boolean): Promise<void> {
    if (!this.client) return;
    // Send to all allowed users via DM
    for (const userId of this.allowedUserIds) {
      try {
        const user = await this.client.users.fetch(userId);
        if (user) {
          await user.send(message);
        }
      } catch (err) {
        logger.error(`Discord notification failed for ${userId}:`, err);
      }
    }
  }

  async setTyping(peerId: string, active: boolean): Promise<void> {
    if (!this.client || !active) return;
    try {
      const channel = await this.client.channels.fetch(peerId);
      if (channel?.isTextBased()) {
        await channel.sendTyping();
      }
    } catch {}
  }

  private async sendResponse(message: any, text: string, tabName?: string): Promise<void> {
    const prefix = tabName && tabName !== 'default' ? `[${tabName}] ` : '';
    const fullText = prefix + text;
    const chunks = chunkText(fullText, this.maxMessageLength);

    // First chunk as reply, rest as follow-ups
    if (chunks.length > 0) {
      await retryWithBackoff(
        () => message.reply(chunks[0]),
        [1000, 5000],
        'discord-reply',
      );
    }
    for (let i = 1; i < chunks.length; i++) {
      await retryWithBackoff(
        () => message.channel.send(chunks[i]),
        [1000, 5000],
        'discord-send',
      );
    }
  }
}
