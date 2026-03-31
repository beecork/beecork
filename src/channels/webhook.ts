import http from 'node:http';
import crypto from 'node:crypto';
import { logger } from '../util/logger.js';
import { validateTabName } from '../config.js';
import type { WebhookConfig } from '../types.js';
import type { Channel, ChannelContext, InboundMessageHandler, MediaAttachment, SendOptions } from './types.js';

export class WebhookChannel implements Channel {
  readonly id = 'webhook';
  readonly name = 'Webhook';
  readonly maxMessageLength = 100000; // Webhooks can handle large payloads
  readonly supportsStreaming = false;
  readonly supportsMedia = false;

  private server: http.Server | null = null;
  private ctx: ChannelContext;

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

      // Validate tab name
      if (tabName !== 'default') {
        const tabError = validateTabName(tabName);
        if (tabError) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: tabError }));
          return;
        }
      }

      // Read body first (needed for both JSON parsing and HMAC verification)
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024 * 1024) { // 1MB limit
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
      }

      // Auth check (after body read, so HMAC can verify body)
      if (!this.authenticate(req, config, body)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
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
    logger.info('Webhook channel stopped');
  }

  onMessage(_handler: InboundMessageHandler): void {
    // Webhooks handle messages directly in the HTTP handler
  }

  async sendMessage(_peerId: string, _text: string, _options?: SendOptions): Promise<void> {
    // Webhooks are request-response — responses are sent in the HTTP handler
  }

  async sendNotification(_message: string, _urgent?: boolean): Promise<void> {
    // Webhook channel doesn't have persistent connections to send notifications to
  }

  async setTyping(_peerId: string, _active: boolean): Promise<void> {
    // No typing indicators for webhooks
  }

  private authenticate(req: http.IncomingMessage, config: WebhookConfig, body: string): boolean {
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
        const expected = 'sha256=' + crypto.createHmac('sha256', config.hmacSecret).update(body).digest('hex');
        try {
          return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
        } catch {
          return false; // Length mismatch or encoding error
        }
      }
    }

    return false;
  }

  private getConfig(): WebhookConfig | undefined {
    return this.ctx.config.webhook;
  }
}
