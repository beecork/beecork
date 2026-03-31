import { logger } from '../util/logger.js';
import { chunkText, parseTabMessage, buildMediaPrompt } from '../util/text.js';
import { retryWithBackoff } from '../util/retry.js';
import { validateTabName } from '../config.js';
import { inboundLimiter } from '../util/rate-limiter.js';
import { saveMedia, isOversized } from '../media/store.js';
import { initVoiceProviders } from '../voice/index.js';
import type { STTProvider } from '../voice/stt.js';
import type { TTSProvider } from '../voice/tts.js';
import { ProgressTracker } from '../util/progress.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';

export class DiscordChannel implements Channel {
  readonly id = 'discord';
  readonly name = 'Discord';
  readonly maxMessageLength = 2000;
  readonly supportsStreaming = false; // Discord message editing is rate-limited
  readonly supportsMedia = true;

  private client: any = null; // Discord.js Client
  private ctx: ChannelContext;
  private handler: InboundMessageHandler | null = null;
  private allowedUserIds: Set<string>;
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.allowedUserIds = new Set(
      ((ctx.config as any).discord?.allowedUserIds ?? []).map(String)
    );
  }

  async start(): Promise<void> {
    const discordConfig = (this.ctx.config as any).discord;
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

      // In DMs: allow if user is in allowlist (or allowlist is empty = allow all)
      // In servers: only respond if @mentioned
      if (isDM) {
        if (this.allowedUserIds.size > 0 && !this.allowedUserIds.has(message.author.id)) return;
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

        // Parse tab name
        const { tabName, prompt } = parseTabMessage(text || '');
        if (!prompt && media.length === 0) return;

        // Handle commands
        if (text.startsWith('/tabs')) {
          const tabs = this.ctx.tabManager.listTabs();
          if (tabs.length === 0) {
            await message.reply('No tabs.');
          } else {
            const list = tabs.map(t => `• **${t.name}** [${t.status}]`).join('\n');
            await message.reply(list);
          }
          return;
        }

        if (text.startsWith('/stop ')) {
          const name = text.slice(6).trim();
          this.ctx.tabManager.stopTab(name);
          await message.reply(`Stopped tab: ${name}`);
          return;
        }

        // /projects — list all projects
        if (text === '/projects') {
          const { listProjects } = await import('../projects/index.js');
          const projects = listProjects();
          if (projects.length === 0) {
            await message.reply('No projects found. Create one with /newproject <name>');
            return;
          }
          const userProjects = projects.filter((p: any) => p.type === 'user-project');
          const categories = projects.filter((p: any) => p.type === 'category');
          let msg2 = '📦 **Projects:**\n';
          if (userProjects.length > 0) {
            msg2 += userProjects.map((p: any) => `  • ${p.name} — ${p.path}`).join('\n');
          }
          if (categories.length > 0) {
            msg2 += '\n\n📁 **Categories:**\n';
            msg2 += categories.map((p: any) => `  • ${p.name}`).join('\n');
          }
          await message.reply(msg2);
          return;
        }

        // /project <name> — switch to a project
        if (text.startsWith('/project ') && !text.startsWith('/projects')) {
          const pname = text.slice(9).trim();
          const { getProject, setUserContext } = await import('../projects/index.js');
          const project = getProject(pname);
          if (!project) {
            await message.reply(`Project "${pname}" not found. Use /projects to list or /newproject to create.`);
            return;
          }
          setUserContext(message.author.id, project.name, project.name);
          await message.reply(`Switched to project: ${project.name}\nPath: ${project.path}\n\nNext messages will work in this project.`);
          return;
        }

        // /newproject <name> [path] — create a new project
        if (text.startsWith('/newproject ')) {
          const parts = text.slice(12).trim().split(/\s+/);
          const pname = parts[0];
          const customPath = parts[1] || undefined;
          if (!pname) {
            await message.reply('Usage: /newproject <name> [path]');
            return;
          }
          const { createProject, setUserContext } = await import('../projects/index.js');
          const project = createProject(pname, customPath);
          setUserContext(message.author.id, project.name, project.name);
          await message.reply(`✓ Project "${pname}" created at ${project.path}\nSwitched to this project.`);
          return;
        }

        // /close <tab> — permanently close a tab
        if (text.startsWith('/close ')) {
          const tabToClose = text.slice(7).trim();
          if (!tabToClose) {
            await message.reply('Usage: /close <tabname>');
            return;
          }
          const { closeTab } = await import('../projects/index.js');
          const closed = closeTab(tabToClose);
          if (closed) {
            await message.reply(`Tab "${tabToClose}" permanently closed. History deleted.`);
          } else {
            await message.reply(`Tab "${tabToClose}" not found.`);
          }
          return;
        }

        // /fresh <project> — start a new tab in a project
        if (text.startsWith('/fresh ')) {
          const projectName = text.slice(7).trim();
          const { getProject, setUserContext } = await import('../projects/index.js');
          const project = getProject(projectName);
          if (!project) {
            await message.reply(`Project "${projectName}" not found.`);
            return;
          }
          const freshTab = `${projectName}-${Date.now().toString(36).slice(-4)}`;
          setUserContext(message.author.id, project.name, freshTab);
          await message.reply(`Fresh start in "${projectName}" (tab: ${freshTab})\nSend your message now.`);
          return;
        }

        // Build prompt with media
        const fullPrompt = buildMediaPrompt(media, prompt || '');

        // Smart project routing (if no explicit /tab command)
        let effectiveTab = tabName;
        let projectPath: string | undefined;

        // Use thread name as tab if in a thread
        if (message.channel.isThread?.()) {
          effectiveTab = message.channel.name || tabName;
        }

        if (effectiveTab === 'default' && !text.startsWith('/tab ')) {
          try {
            const { routeMessage, setUserContext } = await import('../projects/index.js');
            const decision = routeMessage(prompt || '', {
              userId: message.author.id,
            });

            if (decision.needsConfirmation) {
              const { listProjects } = await import('../projects/index.js');
              const projects = listProjects().filter((p: any) => p.type === 'user-project');
              const options = projects.map((p: any, i: number) => `${i + 1}) ${p.name}`).join('\n');
              await message.reply(`Which project?\n${options}\n\nReply with the number, or just send your message with /project <name> first.`);
              return;
            }

            effectiveTab = decision.tabName;
            projectPath = decision.project.path;
            setUserContext(message.author.id, decision.project.name, decision.tabName);
          } catch (err) {
            logger.warn('Project routing failed, using default:', err);
          }
        }

        // Typing indicator refresh
        const typingInterval = setInterval(() => {
          message.channel.sendTyping().catch(() => {});
        }, 8000); // Discord typing lasts 10s

        try {
          // Progress updates for long tasks (every 30 seconds)
          const progressTracker = new ProgressTracker(effectiveTab, (msg) => {
            message.channel.send(msg).catch(() => {});
          });

          const result = await this.ctx.tabManager.sendMessage(effectiveTab, fullPrompt, {
            onToolUse: (name, input) => progressTracker.record(name, input),
            projectPath,
          });
          progressTracker.stop();
          clearInterval(typingInterval);

          const responseText = result.error
            ? `Error: ${result.text}`
            : result.text || '(empty response)';

          // Voice reply if configured
          const voiceMode = this.ctx.config.voice?.replyMode;
          if (this.ttsProvider && (voiceMode === 'voice' || voiceMode === 'both')) {
            try {
              const audioPath = await this.ttsProvider.synthesize(responseText);
              await message.reply({ files: [audioPath] });
              if (voiceMode === 'voice') return;
            } catch (err) {
              logger.warn('Discord TTS failed:', err);
            }
          }

          // Send text response
          await this.sendResponse(message, responseText, effectiveTab);
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

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
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
