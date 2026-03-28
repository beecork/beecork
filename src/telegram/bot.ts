import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs';
import path from 'node:path';
import { chunkText, formatTabStatus } from './formatter.js';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { getTabConfig, getAdminUserId, validateTabName } from '../config.js';
import { getLogsDir } from '../util/paths.js';
import type { TabManager, SendResult } from '../session/manager.js';
import type { BeecorkConfig } from '../types.js';

export class BeecorkTelegramBot {
  private bot: TelegramBot;
  private tabManager: TabManager;
  private config: BeecorkConfig;
  private activeChatIds: Set<number> = new Set();
  // Debounce: collect messages within a window before sending
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceBuffers: Map<string, { messages: string[]; chatId: number; messageId: number }> = new Map();

  constructor(config: BeecorkConfig, tabManager: TabManager) {
    this.config = config;
    this.tabManager = tabManager;
    this.bot = new TelegramBot(config.telegram.token, { polling: true });
    this.setupHandlers();
    logger.info('Telegram bot started (polling mode)');
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

        // Regular messages: debounce
        const { tabName } = this.parseMessage(text);
        const debounceMs = getTabConfig(tabName).debounceMs ?? 3000;
        const key = `${chatId}:${tabName}`;

        // Buffer the message
        if (!this.debounceBuffers.has(key)) {
          this.debounceBuffers.set(key, { messages: [], chatId, messageId: msg.message_id });
        }
        this.debounceBuffers.get(key)!.messages.push(text);

        // Reset timer
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        this.debounceTimers.set(key, setTimeout(() => {
          this.debounceTimers.delete(key);
          const buffer = this.debounceBuffers.get(key);
          this.debounceBuffers.delete(key);
          if (buffer) {
            const combined = buffer.messages.join('\n\n');
            this.handleMessage(buffer.chatId, combined, buffer.messageId).catch(err => {
              logger.error('Telegram: error handling debounced message:', err);
            });
          }
        }, debounceMs));
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

    // React with ⏳
    await this.setReaction(chatId, messageId, '⏳');

    // Typing indicator
    await this.bot.sendChatAction(chatId, 'typing');
    const typingInterval = setInterval(() => {
      this.bot.sendChatAction(chatId, 'typing').catch(() => {});
    }, 4000);

    // "Still working" timeout
    const stillWorkingTimeout = setTimeout(() => {
      this.bot.sendMessage(chatId, `Still working on your request in tab "${tabName}"...`).catch(() => {});
    }, 120000); // 2 minutes

    // Streaming: track the message we edit in-place
    let sentMessageId: number | null = null;
    let accumulatedText = '';
    let lastEditTime = 0;

    const onTextChunk = async (chunk: string) => {
      accumulatedText += chunk;

      // Buffer at least 100 chars and throttle edits to 1/second
      const now = Date.now();
      if (accumulatedText.length < 100 || now - lastEditTime < 1000) return;
      lastEditTime = now;

      try {
        const preview = accumulatedText.slice(0, 4000) + (accumulatedText.length > 4000 ? '...' : '');
        const prefix = tabName !== 'default' ? `[${tabName}] ` : '';
        if (!sentMessageId) {
          const sent = await this.bot.sendMessage(chatId, prefix + preview);
          sentMessageId = sent.message_id;
        } else {
          await this.bot.editMessageText(prefix + preview, { chat_id: chatId, message_id: sentMessageId });
        }
      } catch { /* edit failures are non-critical */ }
    };

    try {
      const result = await this.tabManager.sendMessage(tabName, prompt, { onTextChunk });

      clearInterval(typingInterval);
      clearTimeout(stillWorkingTimeout);

      if (result.error) {
        await this.setReaction(chatId, messageId, '❌');
        await this.bot.sendMessage(chatId, `Error in tab "${tabName}":\n${result.text}`);
        return;
      }

      // React with ✅
      await this.setReaction(chatId, messageId, '✅');

      // Send final response (or edit the streaming message)
      const responseText = result.text || '(empty response)';
      if (sentMessageId) {
        // Edit final content into streaming message
        try {
          const prefix = tabName !== 'default' ? `[${tabName}] ` : '';
          const finalText = prefix + responseText;
          if (finalText.length <= 4096) {
            await this.bot.editMessageText(finalText, { chat_id: chatId, message_id: sentMessageId });
          } else {
            // Too long for edit, send as new messages
            await this.sendResponse(chatId, responseText, tabName);
          }
        } catch {
          await this.sendResponse(chatId, responseText, tabName);
        }
      } else {
        await this.sendResponse(chatId, responseText, tabName);
      }
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
    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.debounceBuffers.clear();
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
