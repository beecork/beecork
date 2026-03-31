import { logger } from '../util/logger.js';
import type { Channel } from './types.js';

/**
 * ChannelRegistry manages the lifecycle of all channels.
 * Channels register themselves, and the registry handles start/stop/broadcast.
 */
export class ChannelRegistry {
  private channels = new Map<string, Channel>();

  /** Register a channel */
  register(channel: Channel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel "${channel.id}" is already registered`);
    }
    this.channels.set(channel.id, channel);
    logger.info(`Channel registered: ${channel.name} (${channel.id})`);
  }

  /** Start all registered channels */
  async start(): Promise<void> {
    for (const [id, channel] of this.channels) {
      try {
        await channel.start();
        logger.info(`Channel started: ${channel.name}`);
      } catch (err) {
        logger.error(`Failed to start channel ${id}:`, err);
      }
    }
  }

  /** Stop all channels */
  stop(): void {
    for (const [id, channel] of this.channels) {
      try {
        channel.stop();
      } catch (err) {
        logger.error(`Failed to stop channel ${id}:`, err);
      }
    }
  }

  /** Get a channel by ID */
  get(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  /** Get all registered channels */
  getAll(): Channel[] {
    return Array.from(this.channels.values());
  }

  /** Broadcast a notification to all channels */
  async broadcastNotify(text: string, urgent?: boolean): Promise<void> {
    await Promise.all(
      Array.from(this.channels.values()).map(channel =>
        channel.sendNotification(text, urgent).catch(err =>
          logger.warn(`${channel.name} notify failed:`, err)
        )
      )
    );
  }
}
