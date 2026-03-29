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
const TAB_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,31}$/;

function signalCronReload(): void {
  fs.writeFileSync(CRON_RELOAD_SIGNAL, String(Date.now()));
}

import { VERSION } from '../version.js';

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
        if (tab !== 'default' && !TAB_NAME_REGEX.test(tab)) {
          return { content: [{ type: 'text' as const, text: `Invalid tab name. Must be alphanumeric + hyphens, max 32 chars.` }], isError: true };
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
        if (!tabName || !TAB_NAME_REGEX.test(tabName)) {
          return { content: [{ type: 'text' as const, text: 'Invalid tab name. Must be alphanumeric + hyphens, max 32 chars.' }], isError: true };
        }
        if (tabName === 'default' || tabName.startsWith('cron:')) {
          return { content: [{ type: 'text' as const, text: `Tab name "${tabName}" is reserved.` }], isError: true };
        }
        const existing = db.prepare('SELECT name FROM tabs WHERE name = ?').get(tabName);
        if (existing) {
          return { content: [{ type: 'text' as const, text: `Tab "${tabName}" already exists.` }] };
        }
        const id = uuidv4();
        const dir = workingDir || os.homedir();
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
