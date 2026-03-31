import fs from 'node:fs';
import { logger } from '../util/logger.js';
import { saveMedia, isOversized } from '../media/store.js';
import { retryWithBackoff } from '../util/retry.js';
import { chunkText, parseTabMessage, buildMediaPrompt } from '../util/text.js';
import { inboundLimiter } from '../util/rate-limiter.js';
import { ProgressTracker } from '../util/progress.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';
import { initVoiceProviders } from '../voice/index.js';
import type { STTProvider } from '../voice/stt.js';
import type { TTSProvider } from '../voice/tts.js';

const WHATSAPP_MAX_LENGTH = 8192;

export class WhatsAppChannel implements Channel {
  readonly id = 'whatsapp';
  readonly name = 'WhatsApp';
  readonly maxMessageLength = WHATSAPP_MAX_LENGTH;
  readonly supportsStreaming = false;
  readonly supportsMedia = true;

  private sock: unknown = null;
  private ctx: ChannelContext;
  private allowedNumbers: Set<string>;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly backoffDelays = [1000, 5000, 15000, 30000, 60000];
  private messageHandler: InboundMessageHandler | null = null;
  private sttProvider: STTProvider | null = null;
  private ttsProvider: TTSProvider | null = null;

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
    this.allowedNumbers = new Set(ctx.config.whatsapp?.allowedNumbers ?? []);
  }

  async start(): Promise<void> {
    // Initialize voice providers
    const { stt, tts } = initVoiceProviders(this.ctx.config.voice);
    this.sttProvider = stt;
    this.ttsProvider = tts;

    try {
      const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } = await import('@whiskeysockets/baileys');
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

        // Rate limit check
        if (!inboundLimiter.check(this.id)) {
          await sock.sendMessage(sender, { text: "I'm receiving too many messages right now. Please wait a moment." }).catch(() => {});
          return;
        }

        const text = msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption || '';

        // Download media (in parallel)
        const waDownloadTasks: Array<Promise<MediaAttachment | null>> = [];
        if (msg.message.imageMessage) {
          waDownloadTasks.push(
            downloadMediaMessage(msg, 'buffer', {})
              .then((buffer: any) => {
                if (buffer && !isOversized(buffer.length)) {
                  const filePath = saveMedia(buffer as Buffer, 'jpg');
                  return { type: 'image' as const, mimeType: msg.message.imageMessage.mimetype || 'image/jpeg', filePath };
                }
                return null;
              })
              .catch(() => null)
          );
        }
        if (msg.message.audioMessage) {
          waDownloadTasks.push(
            downloadMediaMessage(msg, 'buffer', {})
              .then((buffer: any) => {
                if (buffer && !isOversized(buffer.length)) {
                  const ext = msg.message.audioMessage.ptt ? 'ogg' : 'mp3';
                  const filePath = saveMedia(buffer as Buffer, ext);
                  return {
                    type: (msg.message.audioMessage.ptt ? 'voice' : 'audio') as 'voice' | 'audio',
                    mimeType: msg.message.audioMessage.mimetype || 'audio/ogg',
                    filePath,
                    duration: msg.message.audioMessage.seconds ?? undefined,
                  };
                }
                return null;
              })
              .catch(() => null)
          );
        }
        if (msg.message.documentMessage) {
          waDownloadTasks.push(
            downloadMediaMessage(msg, 'buffer', {})
              .then((buffer: any) => {
                if (buffer && !isOversized(buffer.length)) {
                  const ext = msg.message.documentMessage.fileName?.split('.').pop() || 'bin';
                  const filePath = saveMedia(buffer as Buffer, ext, msg.message.documentMessage.fileName ?? undefined);
                  return { type: 'document' as const, mimeType: msg.message.documentMessage.mimetype || 'application/octet-stream', filePath, fileName: msg.message.documentMessage.fileName ?? undefined };
                }
                return null;
              })
              .catch(() => null)
          );
        }
        if (msg.message.videoMessage) {
          waDownloadTasks.push(
            downloadMediaMessage(msg, 'buffer', {})
              .then((buffer: any) => {
                if (buffer && !isOversized(buffer.length)) {
                  const filePath = saveMedia(buffer as Buffer, 'mp4');
                  return { type: 'video' as const, mimeType: msg.message.videoMessage.mimetype || 'video/mp4', filePath, duration: msg.message.videoMessage.seconds ?? undefined };
                }
                return null;
              })
              .catch(() => null)
          );
        }
        const waResults = await Promise.allSettled(waDownloadTasks);
        const media: MediaAttachment[] = waResults
          .filter((r): r is PromiseFulfilledResult<MediaAttachment | null> => r.status === 'fulfilled' && r.value !== null)
          .map(r => r.value!);

        // Transcribe voice messages if STT is configured
        if (this.sttProvider) {
          for (const att of media) {
            if (att.type === 'voice' && att.filePath) {
              try {
                const transcription = await this.sttProvider.transcribe(att.filePath);
                att.caption = `[Transcribed from voice message]: ${transcription}`;
              } catch (err) {
                logger.warn('Voice transcription failed, passing file path instead:', err);
              }
            }
          }
        }

        if (!text && media.length === 0) return;

        try {
          const { tabName, prompt: rawPrompt } = parseTabMessage(text);
          if (!rawPrompt && media.length === 0) return;

          // Build prompt with media references
          const prompt = buildMediaPrompt(media, rawPrompt);

          await sock.sendPresenceUpdate('composing', sender).catch(() => {});

          // Progress updates for long tasks (every 30 seconds)
          const progressTracker = new ProgressTracker(tabName, (msg) => {
            sock.sendMessage(sender, { text: msg }).catch(() => {});
          });

          const result = await this.ctx.tabManager.sendMessage(tabName, prompt, {
            onToolUse: (name, input) => progressTracker.record(name, input),
          });
          progressTracker.stop();
          const responseText = result.error
            ? `Error: ${result.text}`
            : result.text || '(empty response)';

          await sock.sendPresenceUpdate('paused', sender).catch(() => {});

          // TTS: send voice reply if configured
          const voiceReplyMode = this.ctx.config.voice?.replyMode;
          if (this.ttsProvider && (voiceReplyMode === 'voice' || voiceReplyMode === 'both')) {
            try {
              const audioPath = await this.ttsProvider.synthesize(responseText);
              await sock.sendMessage(sender, { audio: { url: audioPath }, mimetype: 'audio/ogg; codecs=opus', ptt: true });
              if (voiceReplyMode === 'voice') return; // Don't send text
            } catch (err) {
              logger.warn('TTS failed, sending text reply:', err);
            }
          }

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
