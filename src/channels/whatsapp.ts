import fs from 'node:fs';
import { logger } from '../util/logger.js';
import { retryWithBackoff } from '../util/retry.js';
import { chunkText, parseTabMessage } from '../util/text.js';
import type { Channel, ChannelContext, InboundMessageHandler, SendOptions } from './types.js';

const WHATSAPP_MAX_LENGTH = 8192;

export class WhatsAppChannel implements Channel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly maxMessageLength = WHATSAPP_MAX_LENGTH;
  readonly supportsStreaming = false;
  readonly supportsMedia = false;

  private sock: unknown = null;
  private ctx: ChannelContext;
  private allowedNumbers: Set<string>;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly backoffDelays = [1000, 5000, 15000, 30000, 60000];
  private messageHandler: InboundMessageHandler | null = null;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.allowedNumbers = new Set(ctx.config.whatsapp?.allowedNumbers ?? []);
  }

  async start(): Promise<void> {
    try {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = await import('@whiskeysockets/baileys');
      const sessionPath = this.ctx.config.whatsapp?.sessionPath ?? `${process.env.HOME}/.beecork/whatsapp-session`;
      fs.mkdirSync(sessionPath, { recursive: true, mode: 0o700 });

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
            this.reconnectAttempts++;
            if (this.reconnectAttempts > this.maxReconnectAttempts) {
              logger.error(`WhatsApp reconnect failed after ${this.maxReconnectAttempts} attempts, giving up`);
              return;
            }
            const delayIdx = Math.min(this.reconnectAttempts - 1, this.backoffDelays.length - 1);
            const delay = this.backoffDelays[delayIdx];
            logger.warn(`WhatsApp connection closed, reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            setTimeout(() => {
              this.start().catch(err => {
                logger.error('WhatsApp reconnect failed:', err);
              });
            }, delay);
          } else {
            logger.error('WhatsApp logged out. Please re-scan QR code.');
          }
        } else if (connection === 'open') {
          this.reconnectAttempts = 0;
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
          const { tabName, prompt } = parseTabMessage(text);
          if (!prompt) return;

          await sock.sendPresenceUpdate('composing', sender).catch(() => {});

          const result = await this.ctx.tabManager.sendMessage(tabName, prompt);
          const responseText = result.error
            ? `Error: ${result.text}`
            : result.text || '(empty response)';

          await sock.sendPresenceUpdate('paused', sender).catch(() => {});
          await this.sendResponse(sender, responseText, tabName);
        } catch (err) {
          logger.error('WhatsApp message handler error:', err);
          await sock.sendMessage(sender, { text: 'Something went wrong processing your message. Check daemon logs for details.' }).catch(() => {});
        }
      });
    } catch (err) {
      logger.error('Failed to start WhatsApp client:', err);
      throw err;
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

  async sendMessage(peerId: string, text: string, _options?: SendOptions): Promise<void> {
    const sock = this.sock as any;
    if (!sock) return;
    const chunks = chunkText(text, WHATSAPP_MAX_LENGTH);
    for (const chunk of chunks) {
      await retryWithBackoff(
        () => sock.sendMessage(peerId, { text: chunk }),
        [1000, 5000, 15000],
        'whatsapp-send',
      );
    }
  }

  async sendNotification(message: string, _urgent?: boolean): Promise<void> {
    const sock = this.sock as any;
    if (!sock) return;
    for (const number of this.allowedNumbers) {
      try {
        await sock.sendMessage(`${number}@s.whatsapp.net`, { text: message });
      } catch (err) {
        logger.error(`Failed to send WhatsApp notification to ${number}:`, err);
      }
    }
  }

  async setTyping(peerId: string, active: boolean): Promise<void> {
    const sock = this.sock as any;
    if (!sock) return;
    const status = active ? 'composing' : 'paused';
    await sock.sendPresenceUpdate(status, peerId).catch(() => {});
  }

  onMessage(handler: InboundMessageHandler): void {
    this.messageHandler = handler;
  }

  // ─── Private ───

  private async sendResponse(jid: string, text: string, tabName?: string): Promise<void> {
    const prefix = tabName && tabName !== 'default' ? `[${tabName}] ` : '';
    const chunks = chunkText(prefix + text, WHATSAPP_MAX_LENGTH);
    const sock = this.sock as any;
    for (const chunk of chunks) {
      try {
        await retryWithBackoff(
          () => sock.sendMessage(jid, { text: chunk }),
          [1000, 5000, 15000],
          'whatsapp-send',
        );
      } catch (err) {
        logger.error(`WhatsApp delivery failed for ${jid}:`, err);
      }
    }
  }

  private isAllowed(jid: string): boolean {
    if (this.allowedNumbers.size === 0) return false;
    const number = jid.replace('@s.whatsapp.net', '');
    return this.allowedNumbers.has(number);
  }
}
