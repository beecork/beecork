import { logger } from '../util/logger.js';
import { chunkTextWA } from './formatter.js';
import type { TabManager } from '../session/manager.js';
import type { BeecorkConfig } from '../types.js';

/**
 * WhatsApp client via Baileys.
 * Uses @whiskeysockets/baileys for reverse-engineered WhatsApp Web connection.
 * Session is persisted in ~/.beecork/whatsapp-session/
 *
 * NOTE: This violates WhatsApp ToS. For personal use only.
 */
export class BeecorkWhatsAppClient {
  private sock: unknown = null;
  private tabManager: TabManager;
  private config: BeecorkConfig;
  private allowedNumbers: Set<string>;

  constructor(config: BeecorkConfig, tabManager: TabManager) {
    this.config = config;
    this.tabManager = tabManager;
    this.allowedNumbers = new Set(config.whatsapp?.allowedNumbers ?? []);
  }

  async start(): Promise<void> {
    try {
      // Dynamic import since baileys might not be installed
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
      const sessionPath = this.config.whatsapp?.sessionPath ?? `${process.env.HOME}/.beecork/whatsapp-session`;

      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
      });

      const sock = this.sock as any;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', (update: any) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
          const reason = (lastDisconnect?.error as any)?.output?.statusCode;
          if (reason !== DisconnectReason.loggedOut) {
            logger.warn('WhatsApp connection closed, reconnecting...');
            this.start(); // Reconnect
          } else {
            logger.error('WhatsApp logged out. Please re-scan QR code.');
          }
        } else if (connection === 'open') {
          logger.info('WhatsApp connected');
        }
      });

      sock.ev.on('messages.upsert', async (m: any) => {
        const msg = m.messages[0];
        if (!msg?.message || msg.key.fromMe) return;

        const sender = msg.key.remoteJid;
        if (!sender || !this.isAllowed(sender)) return;

        const text = msg.message.conversation ||
          msg.message.extendedTextMessage?.text || '';
        if (!text) return;

        try {
          const { tabName, prompt } = this.parseMessage(text);
          if (!prompt) return;

          const result = await this.tabManager.sendMessage(tabName, prompt);
          const responseText = result.error
            ? `Error: ${result.text}`
            : result.text || '(empty response)';

          await this.sendResponse(sender, responseText, tabName);
        } catch (err) {
          logger.error('WhatsApp message handler error:', err);
        }
      });
    } catch (err) {
      logger.error('Failed to start WhatsApp client:', err);
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

  async sendResponse(jid: string, text: string, tabName?: string): Promise<void> {
    const prefix = tabName && tabName !== 'default' ? `[${tabName}] ` : '';
    const chunks = chunkTextWA(prefix + text);
    const sock = this.sock as any;
    for (const chunk of chunks) {
      await sock.sendMessage(jid, { text: chunk });
    }
  }

  async sendNotification(text: string): Promise<void> {
    const sock = this.sock as any;
    if (!sock) return;
    for (const number of this.allowedNumbers) {
      try {
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text });
      } catch (err) {
        logger.error(`Failed to send WhatsApp notification to ${number}:`, err);
      }
    }
  }

  stop(): void {
    const sock = this.sock as any;
    if (sock) {
      sock.end(undefined);
      this.sock = null;
    }
    logger.info('WhatsApp client stopped');
  }

  private isAllowed(jid: string): boolean {
    if (this.allowedNumbers.size === 0) return true; // No filter = allow all
    const number = jid.replace('@s.whatsapp.net', '');
    return this.allowedNumbers.has(number);
  }
}
