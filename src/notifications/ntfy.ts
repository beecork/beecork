import { logger } from '../util/logger.js';
import type { NotificationProvider } from './types.js';

export class NtfyProvider implements NotificationProvider {
  readonly id = 'ntfy';
  readonly name = 'ntfy.sh';

  constructor(private topic: string, private server: string = 'https://ntfy.sh') {}

  async send(message: string, urgent?: boolean): Promise<void> {
    const response = await fetch(`${this.server}/${this.topic}`, {
      method: 'POST',
      headers: {
        'Title': 'Beecork',
        'Priority': urgent ? '5' : '3',
        'Tags': urgent ? 'warning' : 'robot',
      },
      body: message,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`ntfy error: ${response.status}`);
    }
  }
}
