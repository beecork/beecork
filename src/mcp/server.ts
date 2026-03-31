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
const WATCHER_RELOAD_SIGNAL = path.join(BEECORK_HOME, '.watcher-reload');

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

// Cached media generators (lazy singleton, like cachedDb)
let cachedGenerators: any[] | null = null;
async function getGenerators(): Promise<any[]> {
  if (!cachedGenerators) {
    const config = getConfig();
    const { initMediaGenerators } = await import('../media/index.js');
    cachedGenerators = initMediaGenerators(config.mediaGenerators);
  }
  return cachedGenerators;
}

const MAX_CONTENT_LENGTH = 10240; // 10KB
const MAX_NAME_LENGTH = 256;
const VALID_SCHEDULE_TYPES = ['at', 'every', 'cron'];
// Tab name validation is centralized in validateTabName() from config.ts

function signalCronReload(): void {
  fs.writeFileSync(CRON_RELOAD_SIGNAL, String(Date.now()));
}

function signalWatcherReload(): void {
  fs.writeFileSync(WATCHER_RELOAD_SIGNAL, String(Date.now()));
}

import { VERSION } from '../version.js';
import { getConfig, validateTabName } from '../config.js';

async function handleMediaGeneration(db: Database.Database, mediaType: string, args: Record<string, unknown>): Promise<ReturnType<typeof ok>> {
  const { prompt, style, duration, provider } = args as { prompt: string; style?: string; duration?: number; provider?: string };
  if (!prompt) return fail('Missing prompt');

  const generators = await getGenerators();

  const gen = provider
    ? generators.find(g => g.id === provider)
    : generators.find(g => g.supportedTypes.includes(mediaType as any));

  if (!gen) return fail(`No ${mediaType} generator configured. Run: beecork media`);

  try {
    const result = await gen.generate(mediaType as any, prompt, { style, duration });
    db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(
      'default', JSON.stringify({ type: 'media', filePath: result.filePath, caption: prompt.slice(0, 200) }), 'media'
    );
    return ok(`Generated ${mediaType}: ${result.filePath}`);
  } catch (err: any) {
    return fail(`${mediaType} generation failed: ${err.message}`);
  }
}

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
          scope: { type: 'string', enum: ['global', 'project', 'tab', 'auto'], description: 'Where to store: global (about the user), project (about this project), tab (about this conversation), or auto (Claude decides)' },
          category: { type: 'string', description: 'For global scope: people, preferences, routines, or general' },
        },
        required: ['content'],
      },
    },
    {
      name: 'beecork_task_create',
      description: 'Schedule a task that will run automatically. The task sends a message to a Beecork tab at the scheduled time.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Human-readable name for the task' },
          scheduleType: {
            type: 'string',
            enum: ['at', 'every', 'cron'],
            description: '"at" = one-time ISO datetime, "every" = interval like "30m"/"2h"/"1d", "cron" = cron expression like "0 9 * * 1"',
          },
          schedule: { type: 'string', description: 'The schedule value (ISO datetime, interval, or cron expression)' },
          message: { type: 'string', description: 'The prompt/message to send when the task fires' },
          tabName: { type: 'string', description: 'Which tab to send the message to (default: "default")' },
        },
        required: ['name', 'scheduleType', 'schedule', 'message'],
      },
    },
    {
      name: 'beecork_task_list',
      description: 'List all scheduled tasks.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'beecork_task_delete',
      description: 'Delete a scheduled task by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The ID of the task to delete' },
        },
        required: ['id'],
      },
    },
    // Backward-compatible aliases
    {
      name: 'beecork_cron_create',
      description: '[Alias for beecork_task_create] Schedule a task that will run automatically.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Human-readable name for the job' },
          scheduleType: { type: 'string', enum: ['at', 'every', 'cron'] },
          schedule: { type: 'string' },
          message: { type: 'string' },
          tabName: { type: 'string' },
        },
        required: ['name', 'scheduleType', 'schedule', 'message'],
      },
    },
    {
      name: 'beecork_cron_list',
      description: '[Alias for beecork_task_list] List all scheduled tasks.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_cron_delete',
      description: '[Alias for beecork_task_delete] Delete a scheduled task by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
    // Watcher tools
    {
      name: 'beecork_watch_create',
      description: 'Create a watcher that periodically runs a check command and triggers an action when a condition is met.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Human-readable name for the watcher' },
          description: { type: 'string', description: 'What to watch (natural language)' },
          checkCommand: { type: 'string', description: 'Shell command to run for checking' },
          condition: { type: 'string', description: 'When to trigger: "contains X", "not contains X", "> N", "< N", "any", "error"' },
          action: { type: 'string', enum: ['notify', 'fix', 'delegate'], description: 'What to do when triggered (default: notify)' },
          actionDetails: { type: 'string', description: 'For fix: command to run. For delegate: tab name + message.' },
          schedule: { type: 'string', description: 'How often: "every 5m", "every 1h", or cron expression' },
        },
        required: ['name', 'checkCommand', 'condition', 'schedule'],
      },
    },
    {
      name: 'beecork_watch_list',
      description: 'List all watchers with their status.',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_watch_delete',
      description: 'Delete a watcher by ID.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          id: { type: 'string', description: 'The ID of the watcher to delete' },
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
    {
      name: 'beecork_generate_image',
      description: 'Generate an image from a text prompt using the configured image provider (DALL-E, Stable Diffusion, etc.)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'Image description' },
          style: { type: 'string', description: 'Optional style (e.g., "hd", "vivid", "natural")' },
          provider: { type: 'string', description: 'Optional: specific provider to use' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'beecork_generate_video',
      description: 'Generate a video from a text prompt using the configured video provider (Runway, Veo, Kling)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'Video description' },
          duration: { type: 'number', description: 'Duration in seconds (default 5)' },
          provider: { type: 'string', description: 'Optional: specific provider' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'beecork_generate_audio',
      description: 'Generate audio (music or sound effects) from a text prompt',
      inputSchema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'Audio description' },
          type: { type: 'string', enum: ['music', 'sfx'], description: 'Music or sound effect' },
          style: { type: 'string', description: 'Optional: music genre or style' },
          provider: { type: 'string', description: 'Optional: specific provider' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'beecork_media_providers',
      description: 'List configured media generation providers and their capabilities',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_knowledge',
      description: 'List all knowledge Beecork has about the current context (global + project + tab)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          scope: { type: 'string', enum: ['global', 'project', 'tab', 'all'], description: 'Which layer to show (default: all)' },
        },
      },
    },
    {
      name: 'beecork_capabilities',
      description: 'List available and enabled capability packs (email, calendar, github, etc.)',
      inputSchema: { type: 'object' as const, properties: {} },
    },
    {
      name: 'beecork_history',
      description: 'Show activity timeline — what Beecork has been doing',
      inputSchema: {
        type: 'object' as const,
        properties: {
          date: { type: 'string', description: 'Date filter (YYYY-MM-DD). Default: today' },
          tabName: { type: 'string', description: 'Filter by tab name' },
          limit: { type: 'number', description: 'Max events (default 50)' },
        },
      },
    },
    {
      name: 'beecork_replay',
      description: 'Re-run a past task by its event ID',
      inputSchema: {
        type: 'object' as const,
        properties: {
          eventId: { type: 'string', description: 'Activity event ID to replay' },
        },
        required: ['eventId'],
      },
    },
    {
      name: 'beecork_store_search',
      description: 'Search the Beecork store for community packages (capabilities, media generators, channels)',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
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
        const { content, scope, category } = args as { content: string; scope?: string; category?: string };
        if (!content || content.length > MAX_CONTENT_LENGTH) {
          return fail(`Content is required and must be under ${MAX_CONTENT_LENGTH} characters.`);
        }
        if (scope && scope !== 'tab' && scope !== 'auto') {
          const { addKnowledge } = await import('../knowledge/index.js');
          // Determine tab info for project scope
          const currentTab = db.prepare("SELECT working_dir FROM tabs ORDER BY last_activity_at DESC LIMIT 1").get() as { working_dir: string } | undefined;
          addKnowledge(content, scope as any, { category, projectPath: currentTab?.working_dir, tabName: undefined });
          return ok(`Remembered (${scope}): ${content.slice(0, 100)}`);
        }
        // Default: existing tab memory behavior
        const fullContent = category ? `[${category}] ${content}` : content;
        db.prepare('INSERT INTO memories (content, source) VALUES (?, ?)').run(fullContent, 'tool');
        return ok(`Remembered: "${fullContent}"`);
      }

      case 'beecork_task_create':
      case 'beecork_cron_create': {
        const { name: jobName, scheduleType, schedule, message, tabName } = args as {
          name: string; scheduleType: string; schedule: string; message: string; tabName?: string;
        };
        if (!jobName || jobName.length > MAX_NAME_LENGTH) {
          return fail(`Task name is required and must be under ${MAX_NAME_LENGTH} characters.`);
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
          `INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, enabled, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'local', ?)`
        ).run(id, jobName, scheduleType, schedule, tab, message, new Date().toISOString());
        signalCronReload();
        return ok(`Task created: "${jobName}" (${scheduleType}: ${schedule}) -> tab:${tab}\nID: ${id}`);
      }

      case 'beecork_task_list':
      case 'beecork_cron_list': {
        const jobs = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at').all('local') as Array<Record<string, unknown>>;
        if (jobs.length === 0) {
          return ok('No tasks scheduled.');
        }
        const lines = jobs.map(j =>
          `- ${j.name} [${j.enabled ? 'enabled' : 'disabled'}] (${j.schedule_type}: ${j.schedule}) -> tab:${j.tab_name} (ID: ${j.id})`
        );
        return ok(lines.join('\n'));
      }

      case 'beecork_task_delete':
      case 'beecork_cron_delete': {
        const { id } = args as { id: string };
        const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
        if (result.changes === 0) {
          return ok(`No task found with ID: ${id}`);
        }
        signalCronReload();
        return ok(`Deleted task: ${id}`);
      }

      case 'beecork_watch_create': {
        const { name: watchName, description: watchDesc, checkCommand, condition, action, actionDetails, schedule: watchSchedule } = args as {
          name: string; description?: string; checkCommand: string; condition: string;
          action?: string; actionDetails?: string; schedule: string;
        };
        if (!watchName || watchName.length > MAX_NAME_LENGTH) {
          return fail(`Watcher name is required and must be under ${MAX_NAME_LENGTH} characters.`);
        }
        if (!checkCommand) return fail('checkCommand is required.');
        if (!condition) return fail('condition is required.');
        if (!watchSchedule) return fail('schedule is required.');
        const watchId = uuidv4();
        db.prepare(
          `INSERT INTO watchers (id, name, description, check_command, condition, action, action_details, schedule)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(watchId, watchName, watchDesc || null, checkCommand, condition, action || 'notify', actionDetails || null, watchSchedule);
        signalWatcherReload();
        return ok(`Watcher created: "${watchName}" (${watchSchedule})\nID: ${watchId}`);
      }

      case 'beecork_watch_list': {
        const watchers = db.prepare('SELECT * FROM watchers ORDER BY created_at').all() as Array<Record<string, unknown>>;
        if (watchers.length === 0) {
          return ok('No watchers configured.');
        }
        const watchLines = watchers.map(w =>
          `- ${w.name} [${w.enabled ? 'enabled' : 'disabled'}] ${w.schedule} | action: ${w.action} | triggers: ${w.trigger_count} (ID: ${w.id})`
        );
        return ok(watchLines.join('\n'));
      }

      case 'beecork_watch_delete': {
        const { id: watchDelId } = args as { id: string };
        const watchDelResult = db.prepare('DELETE FROM watchers WHERE id = ?').run(watchDelId);
        if (watchDelResult.changes === 0) {
          return ok(`No watcher found with ID: ${watchDelId}`);
        }
        signalWatcherReload();
        return ok(`Deleted watcher: ${watchDelId}`);
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
        // Also search knowledge files
        const { searchKnowledge } = await import('../knowledge/index.js');
        const knowledgeResults = searchKnowledge(query);
        // Merge and return
        const allResults = [
          ...knowledgeResults.map(k => k.content),
          ...memories.map(m => m.content),
        ];
        if (allResults.length === 0) {
          return ok(`No relevant knowledge found matching "${query}".`);
        }
        return ok(allResults.join('\n---\n'));
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
        const taskCount = (db.prepare('SELECT COUNT(*) as c FROM tasks WHERE enabled = 1').get() as { c: number }).c;
        const watcherCount = (db.prepare('SELECT COUNT(*) as c FROM watchers WHERE enabled = 1').get() as { c: number }).c;
        const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;

        const lines = [
          `Tabs: ${tabCount} total, ${activeTabs} running`,
          `Tasks: ${taskCount} active`,
          `Watchers: ${watcherCount} active`,
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
        if (config.webhook?.enabled) {
          channels.push({ id: 'webhook', name: 'Webhook', streaming: false, media: false });
        }
        if (config.discord?.token) {
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
            data = db.prepare("SELECT * FROM tasks ORDER BY created_at").all();
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
        // Mark tab as stopped so daemon's recovery loop cleans up the subprocess
        db.prepare("UPDATE tabs SET status = 'stopped', pid = NULL WHERE name = ? AND status = 'running'").run(tabName);
        const { closeTab } = await import('../projects/index.js');
        const closed = closeTab(tabName);
        return closed ? ok(`Tab "${tabName}" permanently closed.`) : fail(`Tab "${tabName}" not found.`);
      }

      case 'beecork_generate_image': return handleMediaGeneration(db, 'image', args || {});
      case 'beecork_generate_video': return handleMediaGeneration(db, 'video', args || {});
      case 'beecork_generate_audio': return handleMediaGeneration(db, 'audio', args || {});

      case 'beecork_media_providers': {
        const generators = await getGenerators();
        if (generators.length === 0) {
          return ok('No media generators configured. Add mediaGenerators to config.json.');
        }
        const lines = generators.map(g => `- ${g.name} (${g.id}): ${g.supportedTypes.join(', ')}`);
        return ok(lines.join('\n'));
      }

      case 'beecork_knowledge': {
        const { scope: knowledgeScope } = (args || {}) as { scope?: string };
        const { getGlobalKnowledge, getProjectKnowledge, getTabKnowledge, getAllKnowledge, formatKnowledgeForContext } = await import('../knowledge/index.js');
        let entries;
        if (knowledgeScope === 'global') {
          entries = getGlobalKnowledge();
        } else if (knowledgeScope === 'project') {
          const currentTab = db.prepare("SELECT working_dir FROM tabs ORDER BY last_activity_at DESC LIMIT 1").get() as { working_dir: string } | undefined;
          entries = currentTab ? getProjectKnowledge(currentTab.working_dir) : [];
        } else if (knowledgeScope === 'tab') {
          const currentTab = db.prepare("SELECT name FROM tabs ORDER BY last_activity_at DESC LIMIT 1").get() as { name: string } | undefined;
          entries = currentTab ? getTabKnowledge(currentTab.name) : [];
        } else {
          entries = getAllKnowledge();
        }
        if (entries.length === 0) {
          return ok('No knowledge stored yet.');
        }
        return ok(formatKnowledgeForContext(entries));
      }

      case 'beecork_capabilities': {
        const { getAvailablePacks, isEnabled } = await import('../capabilities/index.js');
        const packs = getAvailablePacks();
        const capLines = packs.map(p => {
          const status = isEnabled(p.id) ? '✓ enabled' : '○ available';
          return `${status} | ${p.id} — ${p.name}: ${p.description}`;
        });
        return ok(capLines.join('\n'));
      }

      case 'beecork_history': {
        const { date, tabName, limit } = (args || {}) as any;
        const { getTimeline, formatTimeline } = await import('../timeline/index.js');
        const events = getTimeline({ date: date || new Date().toISOString().slice(0, 10), tabName, limit });
        return ok(formatTimeline(events));
      }

      case 'beecork_replay': {
        const { eventId } = args as { eventId: string };
        const { getReplayInfo } = await import('../timeline/index.js');
        const info = getReplayInfo(eventId);
        if (!info) return fail('Event not found or not replayable.');
        db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(info.tabName, info.message, 'replay');
        return ok(`Replaying in tab "${info.tabName}": ${info.message.slice(0, 200)}`);
      }

      case 'beecork_store_search': {
        const { query } = args as { query: string };
        try {
          const response = await fetch(`https://registry.npmjs.org/-/v1/search?text=beecork+${encodeURIComponent(query)}&size=10`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok) return fail('npm registry search failed');
          const data = await response.json() as any;
          const packages = data.objects?.filter((o: any) => o.package.name.startsWith('beecork-')) || [];
          if (packages.length === 0) return ok(`No beecork packages found for "${query}". You can create one with: beecork channel create <name> or beecork media create <name>`);
          const lines = packages.map((o: any) => `${o.package.name}@${o.package.version} — ${o.package.description || 'No description'}`);
          return ok(`${packages.length} package(s):\n${lines.join('\n')}\n\nInstall: npm install -g <package-name>`);
        } catch {
          return fail('Failed to search npm registry');
        }
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
