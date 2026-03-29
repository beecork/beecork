import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs';
import path from 'node:path';
import { chunkText, formatTabStatus } from './formatter.js';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { getTabConfig, getAdminUserId, validateTabName } from '../config.js';
import { getLogsDir } from '../util/paths.js';
import type { TabManager } from '../session/manager.js';
import type { PipeBrain } from '../pipe/brain.js';
import type { BeecorkConfig } from '../types.js';

export class BeecorkTelegramBot {
  private bot: TelegramBot;
  private tabManager: TabManager;
  private pipeBrain: PipeBrain | null;
  private config: BeecorkConfig;
  private activeChatIds: Set<number> = new Set();

  constructor(config: BeecorkConfig, tabManager: TabManager, pipeBrain: PipeBrain | null = null) {
    this.config = config;
    this.tabManager = tabManager;
    this.pipeBrain = pipeBrain;
    // Clear any stale polling from previous instances before starting
    this.bot = new TelegramBot(config.telegram.token, {
      polling: {
        params: {
          timeout: 30,
          allowed_updates: ['message', 'callback_query'],
        },
        autoStart: false,
      },
    });
    // Drop pending updates from old sessions, then start polling
    this.bot.sendMessage = this.bot.sendMessage.bind(this.bot);
    fetch(`https://api.telegram.org/bot${config.telegram.token}/deleteWebhook?drop_pending_updates=true`)
      .then(() => {
        this.bot.startPolling();
        this.setupHandlers();
        logger.info('Telegram bot started (polling mode, cleared pending updates)');
      })
      .catch((err) => {
        logger.error('Failed to clear pending updates, starting anyway:', err);
        this.bot.startPolling();
        this.setupHandlers();
      });
  }

  private setupHandlers(): void {
    this.bot.on('message', async (msg) => {
      if (!this.isAllowed(msg.from?.id)) return;

      const chatId = msg.chat.id;
      this.activeChatIds.add(chatId);
      const text = msg.text?.trim();
      if (!text) return;

      try {
        // Commands bypass debouncing
        if (text.startsWith('/')) {
          await this.handleCommand(chatId, text, msg.from?.id, msg.message_id);
          return;
        }

        // Send typing indicator immediately so user knows bot received it
        this.bot.sendChatAction(chatId, 'typing').catch((err) => {
          logger.error(`Typing indicator failed for chat ${chatId}:`, err);
        });
        logger.info(`[telegram] Message received from ${msg.from?.id}, sending typing`);

        // Skip debounce — send immediately for responsiveness
        // (debounce adds latency and complexity; queue handles rapid messages)
        await this.handleMessage(chatId, text, msg.message_id);
      } catch (err) {
        logger.error('Telegram: error handling message:', err);
        await this.bot.sendMessage(chatId, `Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  private async handleCommand(chatId: number, text: string, userId: number | undefined, messageId: number): Promise<void> {
    if (text === '/tabs' || text.startsWith('/tabs@')) {
      const tabs = this.tabManager.listTabs();
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
      this.tabManager.stopTab(tabName);
      await this.bot.sendMessage(chatId, `Stopped tab: ${tabName}`);
      return;
    }

    if (text.startsWith('/tab ')) {
      // Validate tab name
      const rest = text.slice(5);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx > 0) {
        const tabName = rest.slice(0, spaceIdx);
        const validationError = validateTabName(tabName);
        if (validationError) {
          await this.bot.sendMessage(chatId, `Invalid tab name: ${validationError}`);
          return;
        }
      }
      // Fall through to handleMessage
      await this.handleMessage(chatId, text, messageId);
      return;
    }

    // Unknown command — treat as regular message
    await this.handleMessage(chatId, text, messageId);
  }

  private async handleMessage(chatId: number, text: string, messageId: number): Promise<void> {
    const { tabName, prompt } = this.parseMessage(text);
    if (!prompt) return;

    logger.info(`[telegram] Handling message for tab "${tabName}" (chat: ${chatId}, msg: ${messageId})`);

    // React with ⏳
    await this.setReaction(chatId, messageId, '⏳');

    // Typing indicator — keep refreshing every 4s (Telegram expires it after 5s)
    const sendTyping = () => this.bot.sendChatAction(chatId, 'typing').catch((err) => {
      logger.error(`Typing indicator failed:`, err);
    });
    await sendTyping();
    const typingInterval = setInterval(sendTyping, 4000);

    // "Still working" timeout
    const stillWorkingTimeout = setTimeout(() => {
      this.bot.sendMessage(chatId, `Still working on your request in tab "${tabName}"...`).catch(() => {});
    }, 120000); // 2 minutes

    try {
      let responseText: string;
      let responseError: boolean;
      let responseTab = tabName;

      if (this.pipeBrain) {
        // Intelligent routing + goal tracking via PipeBrain
        const pipeResult = await this.pipeBrain.process(text, { chatId, userId: 0, messageId });
        responseText = pipeResult.response.text || '(empty response)';
        responseError = pipeResult.response.error;
        responseTab = pipeResult.tabName;

        // Send transparency decisions
        if (pipeResult.decisions.length > 0) {
          const decisionText = pipeResult.decisions.join('\n');
          await this.bot.sendMessage(chatId, decisionText);
        }
      } else {
        // Dumb pipe — direct routing with streaming
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

        const result = await this.tabManager.sendMessage(tabName, prompt, { onTextChunk });
        responseText = result.text || '(empty response)';
        responseError = result.error;

        // If we streamed, do a final edit instead of sending a new message
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
          return; // DONE — don't fall through to sendResponse below
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

  private parseMessage(text: string): { tabName: string; prompt: string } {
    if (text.startsWith('/tab ')) {
      const rest = text.slice(5);
      const spaceIdx = rest.indexOf(' ');
      if (spaceIdx === -1) return { tabName: rest, prompt: '' };
      return { tabName: rest.slice(0, spaceIdx), prompt: rest.slice(spaceIdx + 1).trim() };
    }
    return { tabName: 'default', prompt: text };
  }

  async sendResponse(chatId: number, text: string, tabName?: string): Promise<void> {
    const prefix = tabName && tabName !== 'default' ? `[${tabName}] ` : '';
    const fullText = prefix + text;
    const chunks = chunkText(fullText);

    // For very long outputs: send first 3 chunks + file
    if (chunks.length > 10) {
      for (let i = 0; i < 3; i++) {
        await this.sendWithRetry(chatId, chunks[i]);
      }
      // Send rest as file
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
            await this.bot.sendMessage(chatId, text); // Fallback to plain text
          }
        },
        [1000, 5000, 15000],
        'telegram-send',
      );
    } catch (err) {
      // Log to delivery failures
      const failLog = path.join(getLogsDir(), 'delivery-failures.log');
      const entry = `[${new Date().toISOString()}] chatId=${chatId} error=${err instanceof Error ? err.message : err} text=${text.slice(0, 200)}\n`;
      fs.appendFileSync(failLog, entry);
      logger.error(`Delivery failed after retries for chat ${chatId}`);
    }
  }

  /** Send a notification to all allowed users */
  async sendNotification(text: string): Promise<void> {
    for (const chatId of this.activeChatIds) {
      try {
        await this.bot.sendMessage(chatId, text);
      } catch (err) {
        logger.error(`Failed to send notification to chat ${chatId}:`, err);
      }
    }

    for (const userId of this.config.telegram.allowedUserIds) {
      if (this.activeChatIds.has(userId)) continue;
      try {
        await this.bot.sendMessage(userId, text);
        this.activeChatIds.add(userId);
      } catch { /* User hasn't started conversation yet */ }
    }
  }

  stop(): void {
    this.bot.stopPolling();
    logger.info('Telegram bot stopped');
  }

  private isAllowed(userId: number | undefined): boolean {
    if (!userId) return false;
    return this.config.telegram.allowedUserIds.includes(userId);
  }

  private isAdmin(userId: number | undefined): boolean {
    if (!userId) return false;
    return userId === getAdminUserId();
  }

  /** Set emoji reaction on a message via raw Telegram API */
  private async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.config.telegram.token}/setMessageReaction`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reaction: [{ type: 'emoji', emoji }],
        }),
      });
    } catch {
      // Reactions not supported or failed — non-critical
    }
  }
}
