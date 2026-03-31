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

function ok(text: string) { return { content: [{ type: 'text' as const, text }] }; }
function fail(text: string) { return { content: [{ type: 'text' as const, text }], isError: true as const }; }

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
          template: { type: 'string', description: 'Name of a tab template to apply' },
          systemPrompt: { type: 'string', description: 'Custom system prompt for this tab' },
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
          provider: { type: 'string', description: 'Optional: send via specific provider (pushover, ntfy, webhook-notify). Omit to broadcast to all.' },
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
    {
      name: 'beecork_activity',
      description: 'Show activity summary for the last N hours',
      inputSchema: {
        type: 'object' as const,
        properties: {
          hours: { type: 'number', description: 'Number of hours to look back (default 24)' },
        },
      },
    },
    {
      name: 'beecork_export_data',
      description: 'Export cost and activity data as JSON',
      inputSchema: {
        type: 'object' as const,
        properties: {
          type: { type: 'string', enum: ['costs', 'messages', 'crons'], description: 'Data type to export' },
          days: { type: 'number', description: 'Number of days to export (default 30)' },
        },
        required: ['type'],
      },
    },
    {
      name: 'beecork_handoff',
      description: 'Get session handoff info for a tab — session ID, working dir, and recent context for resuming in terminal',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Tab name to export' },
        },
        required: ['tabName'],
      },
    },
    {
      name: 'beecork_machines',
      description: 'List registered machines and their project paths. Shows which machine handles which projects.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_delegate',
      description: 'Delegate a task to another tab. The target tab runs independently and the result is automatically sent back to the source tab when complete. Use this for tasks that need their own working directory or context.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Target tab name (created if it does not exist)' },
          message: { type: 'string', description: 'The task to delegate' },
          returnToTab: { type: 'string', description: 'Tab to send results back to (defaults to current tab)' },
        },
        required: ['tabName', 'message'],
      },
    },
    {
      name: 'beecork_delegation_status',
      description: 'Check status of delegated tasks',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Filter by source tab (optional)' },
        },
      },
    },
    {
      name: 'beecork_project_create',
      description: 'Create a new project folder in the workspace',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Project name' },
          path: { type: 'string', description: 'Optional: custom path. Defaults to workspace root.' },
        },
        required: ['name'],
      },
    },
    {
      name: 'beecork_project_list',
      description: 'List all known projects and categories',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_close_tab',
      description: 'Permanently close a tab — deletes all history and session. Cannot be undone.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          tabName: { type: 'string', description: 'Tab to permanently close' },
        },
        required: ['tabName'],
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
          return fail(`Content is required and must be under ${MAX_CONTENT_LENGTH} characters.`);
        }
        const fullContent = category ? `[${category}] ${content}` : content;
        db.prepare('INSERT INTO memories (content, source) VALUES (?, ?)').run(fullContent, 'tool');
        return ok(`Remembered: "${fullContent}"`);
      }

      case 'beecork_cron_create': {
        const { name: jobName, scheduleType, schedule, message, tabName } = args as {
          name: string; scheduleType: string; schedule: string; message: string; tabName?: string;
        };
        if (!jobName || jobName.length > MAX_NAME_LENGTH) {
          return fail(`Job name is required and must be under ${MAX_NAME_LENGTH} characters.`);
        }
        if (!VALID_SCHEDULE_TYPES.includes(scheduleType)) {
          return fail(`Invalid scheduleType "${scheduleType}". Must be one of: ${VALID_SCHEDULE_TYPES.join(', ')}`);
        }
        if (!message || message.length > MAX_CONTENT_LENGTH) {
          return fail(`Message is required and must be under ${MAX_CONTENT_LENGTH} characters.`);
        }
        const id = uuidv4();
        const tab = tabName || 'default';
        if (tab !== 'default') {
          const tabError = validateTabName(tab);
          if (tabError) {
            return fail(tabError);
          }
        }
        db.prepare(
          `INSERT INTO cron_jobs (id, name, schedule_type, schedule, tab_name, message, enabled, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'local', ?)`
        ).run(id, jobName, scheduleType, schedule, tab, message, new Date().toISOString());
        signalCronReload();
        return ok(`Cron job created: "${jobName}" (${scheduleType}: ${schedule}) → tab:${tab}\nID: ${id}`);
      }

      case 'beecork_cron_list': {
        const jobs = db.prepare('SELECT * FROM cron_jobs WHERE user_id = ? ORDER BY created_at').all('local') as Array<Record<string, unknown>>;
        if (jobs.length === 0) {
          return ok('No cron jobs scheduled.');
        }
        const lines = jobs.map(j =>
          `- ${j.name} [${j.enabled ? 'enabled' : 'disabled'}] (${j.schedule_type}: ${j.schedule}) → tab:${j.tab_name} (ID: ${j.id})`
        );
        return ok(lines.join('\n'));
      }

      case 'beecork_cron_delete': {
        const { id } = args as { id: string };
        const result = db.prepare('DELETE FROM cron_jobs WHERE id = ?').run(id);
        if (result.changes === 0) {
          return ok(`No cron job found with ID: ${id}`);
        }
        signalCronReload();
        return ok(`Deleted cron job: ${id}`);
      }

      case 'beecork_tab_create': {
        const { name: tabName, workingDir, template: templateName, systemPrompt } = args as { name: string; workingDir?: string; template?: string; systemPrompt?: string };
        if (!tabName) {
          return fail('Tab name is required.');
        }
        const tabCreateError = validateTabName(tabName);
        if (tabCreateError) {
          return fail(tabCreateError);
        }
        const existing = db.prepare('SELECT name FROM tabs WHERE name = ?').get(tabName);
        if (existing) {
          return ok(`Tab "${tabName}" already exists.`);
        }
        // Apply template if specified
        const config = getConfig();
        const template = templateName ? config.tabTemplates?.[templateName] : undefined;
        if (templateName && !template) {
          return fail(`Template "${templateName}" not found. Available: ${Object.keys(config.tabTemplates || {}).join(', ') || 'none'}`);
        }
        const id = uuidv4();
        // Explicit args take precedence over template values
        let dir = workingDir || template?.workingDir || os.homedir();
        dir = dir.startsWith('~') ? dir.replace('~', os.homedir()) : dir;
        dir = path.resolve(dir);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return fail(`Working directory does not exist or is not a directory: ${dir}`);
        }
        const tabSystemPrompt = systemPrompt || template?.systemPrompt || null;
        db.prepare(
          'INSERT INTO tabs (id, name, session_id, status, working_dir, system_prompt) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(id, tabName, uuidv4(), 'idle', dir, tabSystemPrompt);
        const parts = [`Created tab: "${tabName}" (working dir: ${dir})`];
        if (tabSystemPrompt) parts.push(`System prompt: "${tabSystemPrompt.slice(0, 100)}${tabSystemPrompt.length > 100 ? '...' : ''}"`);
        if (templateName) parts.push(`Template: ${templateName}`);
        return ok(parts.join('\n'));
      }

      case 'beecork_tab_list': {
        const tabs = db.prepare('SELECT name, status, working_dir, last_activity_at FROM tabs ORDER BY last_activity_at DESC').all() as Array<{
          name: string; status: string; working_dir: string; last_activity_at: string;
        }>;
        if (tabs.length === 0) {
          return ok('No tabs.');
        }
        const lines = tabs.map(t => `- ${t.name} [${t.status}] dir:${t.working_dir} last:${t.last_activity_at}`);
        return ok(lines.join('\n'));
      }

      case 'beecork_send_message': {
        const { tabName, message } = args as { tabName: string; message: string };
        if (!tabName || !message) {
          return fail('Both tabName and message are required.');
        }
        if (tabName !== 'default') {
          const sendTabError = validateTabName(tabName);
          if (sendTabError) {
            return fail(sendTabError);
          }
        }
        if (message.length > MAX_CONTENT_LENGTH) {
          return fail(`Message must be under ${MAX_CONTENT_LENGTH} characters.`);
        }
        db.prepare('INSERT INTO pending_messages (tab_name, message) VALUES (?, ?)').run(tabName, message);
        return ok(`Message queued for tab "${tabName}".`);
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
          return ok(`No memories found matching "${query}".`);
        }
        const lines = memories.map(m => {
          const scope = m.tab_name ? `tab:${m.tab_name}` : 'global';
          return `- [${m.source}, ${scope}, ${m.created_at}] ${m.content}`;
        });
        return ok(lines.join('\n'));
      }

      case 'beecork_notify': {
        const { message, urgent } = args as { message: string; urgent?: boolean };
        if (!message) {
          return fail('Message is required.');
        }
        const prefix = urgent ? '🚨 ' : '';
        db.prepare("INSERT INTO pending_messages (tab_name, message, type) VALUES ('_notify', ?, 'notification')").run(prefix + message);
        return ok(`Notification sent to user.`);
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
        return ok(lines.join('\n'));
      }

      case 'beecork_send_media': {
        const { filePath, caption, tabName } = args as { filePath: string; caption?: string; tabName?: string };
        if (!fs.existsSync(filePath)) {
          return fail(`File not found: ${filePath}`);
        }
        // Store as pending message with media flag
        const tab = tabName || 'default';
        db.prepare(
          'INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)'
        ).run(tab, JSON.stringify({ type: 'media', filePath, caption }), 'media');
        return ok(`Media queued for sending: ${filePath}`);
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
        if ((config as any).webhook?.enabled) {
          channels.push({ id: 'webhook', name: 'Webhook', streaming: false, media: false });
        }
        if ((config as any).discord?.token) {
          channels.push({ id: 'discord', name: 'Discord', streaming: false, media: true });
        }
        return ok(JSON.stringify(channels, null, 2));
      }

      case 'beecork_cost': {
        const { tabName } = (args || {}) as { tabName?: string };
        const { getCostSummary, formatCostSummary } = await import('../observability/analytics.js');
        const summary = getCostSummary();
        if (tabName) {
          const tab = summary.perTab.find(t => t.name === tabName);
          if (!tab) return fail(`Tab "${tabName}" not found`);
          return ok(`Tab "${tabName}": $${tab.cost.toFixed(4)} (${tab.messages} messages)`);
        }
        return ok(formatCostSummary(summary));
      }

      case 'beecork_failed_deliveries': {
        const failed = db.prepare(
          "SELECT m.content, m.created_at, m.retry_count, t.name as tab_name FROM messages m JOIN tabs t ON t.id = m.tab_id WHERE m.delivery_status = 'failed' ORDER BY m.created_at DESC LIMIT 20"
        ).all();
        if ((failed as any[]).length === 0) {
          return ok('No failed deliveries.');
        }
        const failedLines = (failed as any[]).map((f: any) => `[${f.created_at}] tab:${f.tab_name} retries:${f.retry_count}\n  ${f.content.slice(0, 200)}`);
        return ok(failedLines.join('\n\n'));
      }

      case 'beecork_activity': {
        const hours = (args as any)?.hours || 24;
        const { getActivitySummary, formatActivitySummary } = await import('../observability/analytics.js');
        return ok(formatActivitySummary(getActivitySummary(hours)));
      }

      case 'beecork_export_data': {
        const { type: dataType, days = 30 } = args as { type: string; days?: number };
        const since = new Date(Date.now() - days * 86400000).toISOString();
        let data;
        switch (dataType) {
          case 'costs':
            data = db.prepare("SELECT date(created_at) as day, SUM(cost_usd) as cost, COUNT(*) as messages FROM messages WHERE role = 'assistant' AND created_at > ? GROUP BY date(created_at) ORDER BY day").all(since);
            break;
          case 'messages':
            data = db.prepare("SELECT m.role, m.content, m.cost_usd, m.created_at, t.name as tab FROM messages m JOIN tabs t ON t.id = m.tab_id WHERE m.created_at > ? ORDER BY m.created_at DESC LIMIT 500").all(since);
            break;
          case 'crons':
            data = db.prepare("SELECT * FROM cron_jobs ORDER BY created_at").all();
            break;
          default:
            return fail('Invalid type. Use: costs, messages, or crons');
        }
        return ok(JSON.stringify(data, null, 2));
      }

      case 'beecork_handoff': {
        const { tabName } = args as { tabName: string };
        const tab = db.prepare('SELECT * FROM tabs WHERE name = ?').get(tabName) as any;
        if (!tab) return fail(`Tab "${tabName}" not found`);

        const messages = db.prepare(
          'SELECT role, content FROM messages WHERE tab_id = ? ORDER BY created_at DESC LIMIT 5'
        ).all(tab.id) as Array<{ role: string; content: string }>;

        const info = {
          sessionId: tab.session_id,
          workingDir: tab.working_dir,
          status: tab.status,
          resumeCommand: `beecork attach ${tabName}`,
          manualCommand: `cd ${tab.working_dir} && claude --session-id ${tab.session_id} --resume`,
          recentMessages: messages.reverse().map((m: any) => ({ role: m.role, preview: m.content.slice(0, 200) })),
        };
        return ok(JSON.stringify(info, null, 2));
      }

      case 'beecork_machines': {
        const { listMachines } = await import('../machines/index.js');
        const machines = listMachines();
        return ok(JSON.stringify(machines, null, 2));
      }

      case 'beecork_delegate': {
        const { tabName, message, returnToTab } = args as { tabName: string; message: string; returnToTab?: string };
        try {
          const { createDelegation } = await import('../delegation/manager.js');
          const delegation = createDelegation(returnToTab || 'default', tabName, message, returnToTab);
          // Queue the message for the target tab
          db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(tabName, message, 'delegation');
          return ok(`Delegated to tab "${tabName}". Result will be sent back to "${delegation.returnToTab}" when complete.\n\nDelegation ID: ${delegation.id}`);
        } catch (err: any) {
          return fail(`Delegation failed: ${err.message}`);
        }
      }

      case 'beecork_delegation_status': {
        const { tabName } = (args || {}) as { tabName?: string };
        const { getPendingDelegations } = await import('../delegation/manager.js');
        const delegations = getPendingDelegations(tabName);
        if (delegations.length === 0) {
          return ok('No pending delegations.');
        }
        const lines = delegations.map(d => `${d.sourceTab} → ${d.targetTab} [${d.status}] (depth ${d.depth})\n  "${d.message.slice(0, 100)}"`);
        return ok(lines.join('\n\n'));
      }

      case 'beecork_project_create': {
        const { name, path: customPath } = args as { name: string; path?: string };
        const { createProject } = await import('../projects/index.js');
        const project = createProject(name, customPath);
        return ok(`Project "${name}" created at ${project.path}`);
      }

      case 'beecork_project_list': {
        const { listProjects } = await import('../projects/index.js');
        const projects = listProjects();
        if (projects.length === 0) return ok('No projects discovered. Create one with beecork_project_create.');
        const lines = projects.map(p => `${p.type === 'category' ? '📁' : '📦'} ${p.name} — ${p.path}`);
        return ok(lines.join('\n'));
      }

      case 'beecork_close_tab': {
        const { tabName } = args as { tabName: string };
        const { closeTab } = await import('../projects/index.js');
        const closed = closeTab(tabName);
        return closed ? ok(`Tab "${tabName}" permanently closed.`) : fail(`Tab "${tabName}" not found.`);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return fail(`Beecork error: ${errMsg}`);
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
