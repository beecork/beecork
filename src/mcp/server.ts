#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// MCP server runs as a child of `claude`, not the Beecork daemon.
// It communicates with the daemon via shared SQLite + signal files.

const BEECORK_HOME = process.env.BEECORK_HOME || path.join(os.homedir(), '.beecork');
const DB_PATH = path.join(BEECORK_HOME, 'memory.db');
const CRON_RELOAD_SIGNAL = path.join(BEECORK_HOME, '.cron-reload');

// Cached singleton connection (lives for the MCP server's lifetime)
let cachedDb: Database.Database | null = null;

function getDb(): Database.Database {
  if (cachedDb) return cachedDb;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  cachedDb = db;
  return db;
}

// Clean up on process exit
process.on('exit', () => { cachedDb?.close(); });

const MAX_CONTENT_LENGTH = 10240; // 10KB
const MAX_NAME_LENGTH = 256;
const VALID_SCHEDULE_TYPES = ['at', 'every', 'cron'];
// Tab name validation is centralized in validateTabName() from config.ts

function signalCronReload(): void {
  fs.writeFileSync(CRON_RELOAD_SIGNAL, String(Date.now()));
}

import { VERSION } from '../version.js';
import { getConfig, validateTabName } from '../config.js';

const server = new Server(
  { name: 'beecork', version: VERSION },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'beecork_remember',
      description: 'Store a fact in Beecork\'s long-term memory. Use this for preferences, decisions, server addresses, outcomes, or anything the user might want recalled in future sessions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: { type: 'string', description: 'The fact or information to remember' },
          category: { type: 'string', description: 'Optional category for organizing memories (e.g., "preference", "server", "decision")' },
        },
        required: ['content'],
      },
    },
    {
      name: 'beecork_cron_create',
      description: 'Schedule a task that will run automatically. The task sends a message to a Beecork tab at the scheduled time.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Human-readable name for the job' },
          scheduleType: {
            type: 'string',
            enum: ['at', 'every', 'cron'],
            description: '"at" = one-time ISO datetime, "every" = interval like "30m"/"2h"/"1d", "cron" = cron expression like "0 9 * * 1"',
          },
          schedule: { type: 'string', description: 'The schedule value (ISO datetime, interval, or cron expression)' },
          message: { type: 'string', description: 'The prompt/message to send when the job fires' },
          tabName: { type: 'string', description: 'Which tab to send the message to (default: "default")' },
        },
        required: ['name', 'scheduleType', 'schedule', 'message'],
      },
    },
    {
      name: 'beecork_cron_list',
      description: 'List all scheduled cron jobs.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'beecork_cron_delete',
      description: 'Delete a scheduled cron job by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The ID of the cron job to delete' },
        },
        required: ['id'],
      },
    },
    {
      name: 'beecork_tab_create',
      description: 'Create a new virtual tab for a separate task context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Name for the new tab' },
          workingDir: { type: 'string', description: 'Working directory for the tab (default: ~/)' },
        },
        required: ['name'],
      },
    },
    {
      name: 'beecork_tab_list',
      description: 'List all virtual tabs and their current status.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'beecork_send_message',
      description: 'Send a message to another tab. The message will be processed as if a user sent it.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Name of the tab to send the message to' },
          message: { type: 'string', description: 'The message/prompt to send' },
        },
        required: ['tabName', 'message'],
      },
    },
    {
      name: 'beecork_recall',
      description: 'Search long-term memory for relevant facts, decisions, or outcomes from past sessions.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search term to find relevant memories' },
          limit: { type: 'number', description: 'Max results to return (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'beecork_notify',
      description: 'Send a notification to the user mid-task without ending the session. Use for progress updates, questions, or intermediate results.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message: { type: 'string', description: 'The notification message to send' },
          urgent: { type: 'boolean', description: 'If true, sends with higher priority (default: false)' },
        },
        required: ['message'],
      },
    },
    {
      name: 'beecork_status',
      description: 'Get current Beecork system status: active tabs, cron jobs, uptime.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'beecork_send_media',
      description: 'Send a media file (image, document, etc.) to the user via the active channel. The file must exist on disk.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          filePath: { type: 'string', description: 'Absolute path to the file to send' },
          caption: { type: 'string', description: 'Optional caption for the media' },
          tabName: { type: 'string', description: 'Tab name to determine which channel/peer to send to (optional, defaults to current)' },
        },
        required: ['filePath'],
      },
    },
    {
      name: 'beecork_channels',
      description: 'List active channels and their capabilities',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_cost',
      description: 'Show cost tracking: spend per tab, today, and rolling 30 days',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Optional: show cost for a specific tab only' },
        },
      },
    },
    {
      name: 'beecork_failed_deliveries',
      description: 'Show messages that failed to deliver after retries',
      inputSchema: { type: 'object' as const, properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const db = getDb();

    switch (name) {
      case 'beecork_remember': {
        const { content, category } = args as { content: string; category?: string };
        if (!content || content.length > MAX_CONTENT_LENGTH) {
          return { content: [{ type: 'text' as const, text: `Content is required and must be under ${MAX_CONTENT_LENGTH} characters.` }], isError: true };
        }
        const fullContent = category ? `[${category}] ${content}` : content;
        db.prepare('INSERT INTO memories (content, source) VALUES (?, ?)').run(fullContent, 'tool');
        return { content: [{ type: 'text' as const, text: `Remembered: "${fullContent}"` }] };
      }

      case 'beecork_cron_create': {
        const { name: jobName, scheduleType, schedule, message, tabName } = args as {
          name: string; scheduleType: string; schedule: string; message: string; tabName?: string;
        };
        if (!jobName || jobName.length > MAX_NAME_LENGTH) {
          return { content: [{ type: 'text' as const, text: `Job name is required and must be under ${MAX_NAME_LENGTH} characters.` }], isError: true };
        }
        if (!VALID_SCHEDULE_TYPES.includes(scheduleType)) {
          return { content: [{ type: 'text' as const, text: `Invalid scheduleType "${scheduleType}". Must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}` }], isError: true };
        }
        if (!message || message.length > MAX_CONTENT_LENGTH) {
          return { content: [{ type: 'text' as const, text: `Message is required and must be under ${MAX_CONTENT_LENGTH} characters.` }], isError: true };
        }
        const id = uuidv4();
        const tab = tabName || 'default';
        if (tab !== 'default') {
          const tabError = validateTabName(tab);
          if (tabError) {
            return { content: [{ type: 'text' as const, text: tabError }], isError: true };
          }
        }
        db.prepare(
          `INSERT INTO cron_jobs (id, name, schedule_type, schedule, tab_name, message, enabled, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'local', ?)`
        ).run(id, jobName, scheduleType, schedule, tab, message, new Date().toISOString());
        signalCronReload();
        return { content: [{ type: 'text' as const, text: `Cron job created: "${jobName}" (${scheduleType}: ${schedule}) → tab:${tab}\nID: ${id}` }] };
      }

      case 'beecork_cron_list': {
        const jobs = db.prepare('SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at').all('local') as Array<Record<string, unknown>>;
        if (jobs.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No cron jobs scheduled.' }] };
        }
        const lines = jobs.map(j =>
          `- ${j.name} [${j.enabled ? 'enabled' : 'disabled'}] (${j.schedule_type}: ${j.schedule}) → tab:${j.tab_name} (ID: ${j.id})`
        );
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'beecork_cron_delete': {
        const { id } = args as { id: string };
        const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
        if (result.changes === 0) {
          return { content: [{ type: 'text' as const, text: `No cron job found with ID: ${id}` }] };
        }
        signalCronReload();
        return { content: [{ type: 'text' as const, text: `Deleted cron job: ${id}` }] };
      }

      case 'beecork_tab_create': {
        const { name: tabName, workingDir } = args as { name: string; workingDir?: string };
        if (!tabName) {
          return { content: [{ type: 'text' as const, text: 'Tab name is required.' }], isError: true };
        }
        const tabCreateError = validateTabName(tabName);
        if (tabCreateError) {
          return { content: [{ type: 'text' as const, text: tabCreateError }], isError: true };
        }
        const existing = db.prepare('SELECT name FROM tabs WHERE name = ?').get(tabName);
        if (existing) {
          return { content: [{ type: 'text' as const, text: `Tab "${tabName}" already exists.` }] };
        }
        const id = uuidv4();
        let dir = workingDir || os.homedir();
        dir = dir.startsWith('~') ? dir.replace('~', os.homedir()) : dir;
        dir = path.resolve(dir);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return { content: [{ type: 'text' as const, text: `Working directory does not exist or is not a directory: ${dir}` }], isError: true };
        }
        db.prepare(
          'INSERT INTO tabs (id, name, session_id, status, working_dir) VALUES (?, ?, ?, ?, ?)'
        ).run(id, tabName, uuidv4(), 'idle', dir);
        return { content: [{ type: 'text' as const, text: `Created tab: "${tabName}" (working dir: ${dir})` }] };
      }

      case 'beecork_tab_list': {
        const tabs = db.prepare('SELECT name, status, working_dir, last_activity_at FROM tabs ORDER BY last_activity_at DESC').all() as Array<{
          name: string; status: string; working_dir: string; last_activity_at: string;
        }>;
        if (tabs.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No tabs.' }] };
        }
        const lines = tabs.map(t => `- ${t.name} [${t.status}] dir:${t.working_dir} last:${t.last_activity_at}`);
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'beecork_send_message': {
        const { tabName, message } = args as { tabName: string; message: string };
        if (!tabName || !message) {
          return { content: [{ type: 'text' as const, text: 'Both tabName and message are required.' }], isError: true };
        }
        if (tabName !== 'default') {
          const sendTabError = validateTabName(tabName);
          if (sendTabError) {
            return { content: [{ type: 'text' as const, text: sendTabError }], isError: true };
          }
        }
        if (message.length > MAX_CONTENT_LENGTH) {
          return { content: [{ type: 'text' as const, text: `Message must be under ${MAX_CONTENT_LENGTH} characters.` }], isError: true };
        }
        db.prepare('INSERT INTO pending_messages (tab_name, message) VALUES (?, ?)').run(tabName, message);
        return { content: [{ type: 'text' as const, text: `Message queued for tab "${tabName}".` }] };
      }

      case 'beecork_recall': {
        const { query, limit } = args as { query: string; limit?: number };
        const maxResults = Math.min(limit ?? 10, 50);
        const memories = db.prepare(
          'SELECT content, tab_name, source, created_at FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?'
        ).all(`%${query}%`, maxResults) as Array<{
          content: string; tab_name: string | null; source: string; created_at: string;
        }>;
        if (memories.length === 0) {
          return { content: [{ type: 'text' as const, text: `No memories found matching "${query}".` }] };
        }
        const lines = memories.map(m => {
          const scope = m.tab_name ? `tab:${m.tab_name}` : 'global';
          return `- [${m.source}, ${scope}, ${m.created_at}] ${m.content}`;
        });
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'beecork_notify': {
        const { message, urgent } = args as { message: string; urgent?: boolean };
        if (!message) {
          return { content: [{ type: 'text' as const, text: 'Message is required.' }], isError: true };
        }
        const prefix = urgent ? '🚨 ' : '';
        db.prepare("INSERT INTO pending_messages (tab_name, message, type) VALUES ('_notify', ?, 'notification')").run(prefix + message);
        return { content: [{ type: 'text' as const, text: `Notification sent to user.` }] };
      }

      case 'beecork_status': {
        const tabCount = (db.prepare('SELECT COUNT(*) as c FROM tabs').get() as { c: number }).c;
        const activeTabs = (db.prepare("SELECT COUNT(*) as c FROM tabs WHERE status = 'running'").get() as { c: number }).c;
        const cronCount = (db.prepare('SELECT COUNT(*) as c FROM cron_jobs WHERE enabled = 1').get() as { c: number }).c;
        const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;

        const lines = [
          `Tabs: ${tabCount} total, ${activeTabs} running`,
          `Cron jobs: ${cronCount} active`,
          `Memories: ${memoryCount} stored`,
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'beecork_send_media': {
        const { filePath, caption, tabName } = args as { filePath: string; caption?: string; tabName?: string };
        if (!fs.existsSync(filePath)) {
          return { content: [{ type: 'text' as const, text: `File not found: ${filePath}` }], isError: true };
        }
        // Store as pending message with media flag
        const tab = tabName || 'default';
        db.prepare(
          'INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)'
        ).run(tab, JSON.stringify({ type: 'media', filePath, caption }), 'media');
        return { content: [{ type: 'text' as const, text: `Media queued for sending: ${filePath}` }] };
      }

      case 'beecork_channels': {
        // Read channel info from config to show configured channels
        const config = getConfig();
        const channels = [];
        if (config.telegram?.token) {
          channels.push({ id: 'telegram', name: 'Telegram', streaming: true, media: true });
        }
        if (config.whatsapp?.enabled) {
          channels.push({ id: 'whatsapp', name: 'WhatsApp', streaming: false, media: true });
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(channels, null, 2) }],
        };
      }

      case 'beecork_cost': {
        const { tabName } = (args || {}) as { tabName?: string };

        // Per-tab costs
        let tabCosts;
        if (tabName) {
          const tab = db.prepare('SELECT id, name FROM tabs WHERE name = ?').get(tabName) as { id: string; name: string } | undefined;
          if (!tab) return { content: [{ type: 'text' as const, text: `Tab "${tabName}" not found` }], isError: true };
          const cost = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total, COUNT(*) as messages FROM messages WHERE tab_id = ?').get(tab.id) as { total: number; messages: number };
          tabCosts = [{ name: tab.name, cost: cost.total, messages: cost.messages }];
        } else {
          tabCosts = db.prepare(`
            SELECT t.name, COALESCE(SUM(m.cost_usd), 0) as cost, COUNT(m.id) as messages
            FROM tabs t LEFT JOIN messages m ON m.tab_id = t.id
            GROUP BY t.id ORDER BY cost DESC
          `).all() as Array<{ name: string; cost: number; messages: number }>;
        }

        // Today's spend
        const today = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now')").get() as { total: number };

        // 30-day spend
        const month = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now', '-30 days')").get() as { total: number };

        const lines = [
          `Today: $${today.total.toFixed(4)}`,
          `30 days: $${month.total.toFixed(4)}`,
          '',
          'Per tab:',
          ...tabCosts.map((t: any) => `  ${t.name}: $${t.cost.toFixed(4)} (${t.messages} messages)`),
        ];

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      }

      case 'beecork_failed_deliveries': {
        const failed = db.prepare(
          "SELECT m.content, m.created_at, m.retry_count, t.name as tab_name FROM messages m JOIN tabs t ON t.id = m.tab_id WHERE m.delivery_status = 'failed' ORDER BY m.created_at DESC LIMIT 20"
        ).all();
        if ((failed as any[]).length === 0) {
          return { content: [{ type: 'text' as const, text: 'No failed deliveries.' }] };
        }
        const failedLines = (failed as any[]).map((f: any) => `[${f.created_at}] tab:${f.tab_name} retries:${f.retry_count}\n  ${f.content.slice(0, 200)}`);
        return { content: [{ type: 'text' as const, text: failedLines.join('\n\n') }] };
      }

      default:
        return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Beecork error: ${errMsg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
