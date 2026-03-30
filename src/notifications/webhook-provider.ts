import { logger } from '../util/logger.js';
import type { NotificationProvider } from './types.js';

export class WebhookNotificationProvider implements NotificationProvider {
  readonly id = 'webhook-notify';
  readonly name = 'Webhook';

  constructor(private url: string, private headers?: Record<string, string>) {}

  async send(message: string, urgent?: boolean): Promise<void> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({ message, urgent: !!urgent, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Webhook notification error: ${response.status}`);
    }
  }
}
