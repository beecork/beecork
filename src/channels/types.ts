import type { TabManager } from '../session/manager.js';
import type { PipeBrain } from '../pipe/brain.js';
import type { BeecorkConfig } from '../types.js';

/** A media file attached to a message */
export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'document' | 'voice';
  mimeType: string;
  filePath: string;
  fileName?: string;
  duration?: number;
  caption?: string;
}

/** An inbound message from any channel */
export interface InboundMessage {
  channelId: string;
  peerId: string;
  text?: string;
  media?: MediaAttachment[];
  replyTo?: string;
  isGroup: boolean;
  groupId?: string;
  isMentioned?: boolean;
  isReply?: boolean;
  messageId: string;
  raw: unknown;
}

/** Options for sending a message */
export interface SendOptions {
  parseMode?: 'markdown' | 'plain';
  replyToMessageId?: string;
}

/** Handler for inbound messages */
export type InboundMessageHandler = (message: InboundMessage) => Promise<void>;

/** The Channel interface — all channels must implement this */
export interface Channel {
  /** Unique channel identifier (e.g., 'telegram', 'whatsapp', 'discord') */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;
  /** Maximum message length in characters */
  readonly maxMessageLength: number;
  /** Whether this channel supports live streaming of responses */
  readonly supportsStreaming: boolean;
  /** Whether this channel supports media attachments */
  readonly supportsMedia: boolean;

  /** Start the channel (connect, start polling, etc.) */
  start(): Promise<void>;
  /** Stop the channel gracefully */
  stop(): void;
  /** Send a text message to a specific peer */
  sendMessage(peerId: string, text: string, options?: SendOptions): Promise<void>;
  /** Send a media attachment to a peer (optional — check supportsMedia) */
  sendMedia?(peerId: string, media: MediaAttachment): Promise<void>;
  /** Send a notification to all configured recipients */
  sendNotification(message: string, urgent?: boolean): Promise<void>;
  /** Set typing indicator for a peer */
  setTyping(peerId: string, active: boolean): Promise<void>;
  /** Register the inbound message handler — called by the registry */
  onMessage(handler: InboundMessageHandler): void;
}

/** Context passed to channels during construction */
export interface ChannelContext {
  config: BeecorkConfig;
  tabManager: TabManager;
  pipeBrain: PipeBrain | null;
  /** Broadcast notification to all channels + notification providers */
  notifyCallback?: (message: string) => Promise<void>;
}
