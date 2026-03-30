import http from 'node:http';
import crypto from 'node:crypto';
import { logger } from '../util/logger.js';
import { parseTabMessage } from '../util/text.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';

export interface WebhookConfig {
  enabled: boolean;
  port: number;
  authToken?: string;
  hmacSecret?: string;
}

export class WebhookChannel implements Channel {
  readonly id = 'webhook';
  readonly name = 'Webhook';
  readonly maxMessageLength = 100000; // Webhooks can handle large payloads
  readonly supportsStreaming = false;
  readonly supportsMedia = false;

  private server: http.Server | null = null;
  private ctx: ChannelContext;
  private handler: InboundMessageHandler | null = null;
  private pendingResponses = new Map<string, { resolve: (text: string) => void; timer: NodeJS.Timeout }>();

  constructor(ctx: ChannelContext) {
    this.ctx = ctx;
  }

  async start(): Promise<void> {
    const config = this.getConfig();
    if (!config?.enabled) return;

    const port = config.port || 8374;

    this.server = http.createServer(async (req, res) => {
      // CORS headers for API clients
      res.setHeader('Content-Type', 'application/json');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Parse URL
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const match = url.pathname.match(/^\/webhook\/(.+)$/);
      if (!match) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Use POST /webhook/:tabName' }));
        return;
      }

      const tabName = decodeURIComponent(match[1]);

      // Auth check
      if (!this.authenticate(req, config)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // Read body
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024 * 1024) { // 1MB limit
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
      }

      let payload: { prompt?: string; message?: string; sync?: boolean };
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const prompt = payload.prompt || payload.message || '';
      if (!prompt) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Missing "prompt" or "message" field' }));
        return;
      }

      const isSync = payload.sync ?? false;

      try {
        if (isSync) {
          // Sync mode: wait for Claude response
          const result = await this.ctx.tabManager.sendMessage(tabName, prompt);
          res.writeHead(result.error ? 500 : 200);
          res.end(JSON.stringify({
            text: result.text,
            tab: tabName,
            costUsd: result.costUsd,
            durationMs: result.durationMs,
            error: result.error,
          }));
        } else {
          // Async mode: accept and process in background
          this.ctx.tabManager.sendMessage(tabName, prompt).catch(err => {
            logger.error(`Webhook async processing failed for tab ${tabName}:`, err);
          });
          res.writeHead(202);
          res.end(JSON.stringify({ accepted: true, tab: tabName }));
        }
      } catch (err) {
        logger.error('Webhook handler error:', err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'Internal error' }));
      }
    });

    this.server.listen(port, '127.0.0.1', () => {
      logger.info(`Webhook channel listening on http://127.0.0.1:${port}/webhook/:tabName`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    // Clean up pending responses
    for (const [, pending] of this.pendingResponses) {
      clearTimeout(pending.timer);
    }
    this.pendingResponses.clear();
    logger.info('Webhook channel stopped');
  }

  onMessage(handler: InboundMessageHandler): void {
    this.handler = handler;
  }

  async sendMessage(peerId: string, text: string, options?: SendOptions): Promise<void> {
    // Webhooks are request-response — responses are sent in the HTTP handler
    // This is used for sync mode responses
    const pending = this.pendingResponses.get(peerId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(text);
      this.pendingResponses.delete(peerId);
    }
  }

  async sendNotification(message: string, urgent?: boolean): Promise<void> {
    // Webhook channel doesn't have persistent connections to send notifications to
    // Notifications go through other channels
  }

  async setTyping(peerId: string, active: boolean): Promise<void> {
    // No typing indicators for webhooks
  }

  private authenticate(req: http.IncomingMessage, config: WebhookConfig): boolean {
    // No auth configured = allow all (localhost only)
    if (!config.authToken && !config.hmacSecret) return true;

    // Bearer token auth
    if (config.authToken) {
      const authHeader = req.headers.authorization;
      if (authHeader === `Bearer ${config.authToken}`) return true;
    }

    // HMAC signature auth (for GitHub-style webhooks)
    if (config.hmacSecret) {
      const signature = req.headers['x-hub-signature-256'] as string;
      if (signature) {
        // Body needs to be read first for HMAC — simplified here
        // Full HMAC validation would require buffering the body first
        return true; // TODO: implement full HMAC verification
      }
    }

    return false;
  }

  private getConfig(): WebhookConfig | undefined {
    return (this.ctx.config as any).webhook;
  }
}
