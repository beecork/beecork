export type { NotificationProvider } from './types.js';
export { PushoverProvider } from './pushover.js';
export { NtfyProvider } from './ntfy.js';
export { WebhookNotificationProvider } from './webhook-provider.js';

import { logger } from '../util/logger.js';
import type { NotificationProvider } from './types.js';
import { PushoverProvider } from './pushover.js';
import { NtfyProvider } from './ntfy.js';
import { WebhookNotificationProvider } from './webhook-provider.js';

export function createNotificationProvider(config: any): NotificationProvider | null {
  if (!config?.type) return null;
  switch (config.type) {
    case 'pushover':
      if (!config.userKey || !config.appToken) { logger.warn('Pushover: missing userKey or appToken'); return null; }
      return new PushoverProvider(config.userKey, config.appToken);
    case 'ntfy':
      if (!config.topic) { logger.warn('ntfy: missing topic'); return null; }
      return new NtfyProvider(config.topic, config.server);
    case 'webhook':
      if (!config.url) { logger.warn('Webhook notification: missing url'); return null; }
      return new WebhookNotificationProvider(config.url, config.headers);
    default:
      logger.warn(`Unknown notification provider: ${config.type}`);
      return null;
  }
}
