import type { NotificationProvider } from './types.js';

export class PushoverProvider implements NotificationProvider {
  readonly id = 'pushover';
  readonly name = 'Pushover';

  constructor(private userKey: string, private appToken: string) {}

  async send(message: string, urgent?: boolean): Promise<void> {
    const response = await fetch('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: this.appToken,
        user: this.userKey,
        message: message.slice(0, 1024),
        priority: urgent ? 1 : 0,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`Pushover API error: ${response.status}`);
    }
  }
}
