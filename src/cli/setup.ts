import readline from 'node:readline';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { saveConfig, getConfig } from '../config.js';
import { ensureBeecorkDirs, getMcpConfigPath, getBeecorkHome } from '../util/paths.js';
import { installService } from '../service/install.js';
import { getDb, closeDb } from '../db/index.js';
import type { BeecorkConfig } from '../types.js';

function ask(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

function findClaudeBin(): string {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    return 'claude';
  }
}

export async function setupWizard(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n🔧 Beecork Setup\n');
  console.log('This wizard will configure Beecork to make Claude Code always-on.\n');

  try {
    // 0. Auto-detect Claude Code
    console.log('Checking prerequisites...\n');
    try {
      const version = execSync('claude --version 2>&1', { encoding: 'utf-8' }).trim();
      console.log(`  \u2713 Claude Code found: ${version}`);
    } catch {
      console.log('  \u2717 Claude Code not found. Install: npm install -g @anthropic-ai/claude-code');
    }
    console.log('');

    // 1. Telegram token with step-by-step instructions
    console.log('Step 1: Create a Telegram Bot');
    console.log('  1. Open Telegram and search for @BotFather');
    console.log('  2. Send /newbot');
    console.log('  3. Choose a name (e.g., "My Beecork")');
    console.log('  4. Choose a username (must end in "bot", e.g., "mybeecork_bot")');
    console.log('  5. Copy the token BotFather gives you\n');

    let token = '';
    while (!token) {
      token = await ask(rl, 'Paste your Telegram Bot token');
      if (!token) {
        console.log('Telegram token is required. Get one from @BotFather on Telegram.');
        continue;
      }

      // Validate token by calling getMe
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
          const data = await resp.json() as { result: { username: string } };
          console.log(`  \u2713 Connected to bot: @${data.result.username}\n`);
        } else {
          console.log('  \u2717 Invalid token. Please check and try again.\n');
          token = '';
        }
      } catch {
        console.log('  \u26A0 Could not verify token (network error). Continuing anyway.\n');
      }
    }

    // 2. Telegram user ID
    console.log('Step 2: Find your Telegram User ID');
    console.log('  1. Search for @userinfobot on Telegram');
    console.log('  2. Send it any message');
    console.log('  3. It will reply with your user ID (a number like 123456789)\n');

    const userIdStr = await ask(rl, 'Your Telegram user ID');
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) {
      console.log('Invalid user ID. Must be a number.');
      return;
    }

    // 3. Claude binary path
    const defaultBin = findClaudeBin();
    const claudeBin = await ask(rl, 'Path to claude binary', defaultBin);

    // 4. Default working directory
    const defaultDir = await ask(rl, 'Default working directory', os.homedir());

    // 5. Anthropic API key (optional - enables intelligent pipe)
    console.log('\n  Intelligent routing (optional): Beecork can route messages to the right');
    console.log('  project automatically and track goal completion. Requires an Anthropic API key.');
    const apiKey = await ask(rl, 'Anthropic API key (press Enter to skip)');

    // 6. Project scan paths
    let scanPaths = ['~/Coding', '~/Projects', '~/code', '~/dev'];
    if (apiKey) {
      const scanInput = await ask(rl, 'Project scan paths (comma-separated)', scanPaths.join(', '));
      scanPaths = scanInput.split(',').map(s => s.trim()).filter(Boolean);
    }

    // 7. Install as service?
    const installServiceAnswer = await ask(rl, 'Install as background service? (y/n)', 'y');
    const shouldInstallService = installServiceAnswer.toLowerCase() === 'y';

    // Build config
    const config: BeecorkConfig = {
      ...getConfig(),
      telegram: {
        token,
        allowedUserIds: [userId],
      },
      claudeCode: {
        bin: claudeBin,
        defaultFlags: ['--dangerously-skip-permissions'],
      },
      tabs: {
        default: {
          workingDir: defaultDir,
          approvalMode: 'yolo',
          approvalTimeoutMinutes: 30,
        },
      },
      memory: {
        enabled: true,
        dbPath: '~/.beecork/memory.db',
        maxLongTermEntries: 1000,
      },
      pipe: {
        enabled: !!apiKey,
        anthropicApiKey: apiKey,
        routingModel: 'claude-haiku-4-5-20251001',
        complexModel: 'claude-sonnet-4-6-20250514',
        confidenceThreshold: 0.75,
        projectScanPaths: scanPaths,
        maxFollowUps: 5,
      },
      deployment: 'local',
    };

    // Write everything
    ensureBeecorkDirs();
    saveConfig(config);
    console.log(`\n✓ Config saved to ${getBeecorkHome()}/config.json`);

    // Initialize database
    getDb();
    closeDb();
    console.log('✓ Database initialized');

    // Generate MCP config
    generateMcpConfig();
    console.log(`✓ MCP config generated at ${getMcpConfigPath()}`);

    // Inject Beecork instructions into global CLAUDE.md
    injectClaudeMd();
    console.log('✓ Beecork tools injected into ~/.claude/CLAUDE.md');

    // Scan for projects if pipe is enabled
    if (config.pipe.enabled) {
      const { scanForProjects } = await import('../pipe/project-scanner.js');
      const { PipeMemoryStore } = await import('../pipe/memory-store.js');
      const projects = scanForProjects(config.pipe.projectScanPaths);
      const store = new PipeMemoryStore();
      for (const p of projects) { store.upsertProject(p); }
      console.log(`✓ Discovered ${projects.length} projects`);
      closeDb();
    }

    // Install service
    if (shouldInstallService) {
      try {
        const servicePath = installService();
        console.log(`✓ Service installed at ${servicePath}`);
      } catch (err) {
        console.log(`⚠ Service install failed: ${err instanceof Error ? err.message : err}`);
        console.log('  You can start beecork manually with: beecork start');
      }
    }

    console.log('\n✅ Setup complete!\n');
    console.log('  Start the daemon: beecork start');
    console.log('  Then send a message to your Telegram bot to test.\n');
    console.log('  Run "beecork quickstart" for a full getting-started checklist.\n');

  } finally {
    rl.close();
  }
}

function generateMcpConfig(): void {
  // Find the MCP server path
  const distDir = path.dirname(new URL(import.meta.url).pathname);
  // In dist: cli/setup.js -> ../mcp/server.js
  const mcpServerPath = path.resolve(distDir, '..', 'mcp', 'server.js');

  // For development (tsx), use the src path
  const srcMcpPath = path.resolve(distDir, '..', 'mcp', 'server.ts');

  let serverCommand: string;
  let serverArgs: string[];

  if (fs.existsSync(mcpServerPath)) {
    serverCommand = 'node';
    serverArgs = [mcpServerPath];
  } else if (fs.existsSync(srcMcpPath)) {
    // Development mode: use tsx
    serverCommand = 'npx';
    serverArgs = ['tsx', srcMcpPath];
  } else {
    // Fallback: assume global install
    serverCommand = 'node';
    serverArgs = [mcpServerPath];
  }

  const mcpConfig = {
    mcpServers: {
      beecork: {
        command: serverCommand,
        args: serverArgs,
        env: {
          BEECORK_HOME: getBeecorkHome(),
        },
      },
    },
  };

  fs.writeFileSync(getMcpConfigPath(), JSON.stringify(mcpConfig, null, 2) + '\n');
}

const BEECORK_MARKER_START = '<!-- BEECORK START -->';
const BEECORK_MARKER_END = '<!-- BEECORK END -->';

const BEECORK_CLAUDE_MD = `${BEECORK_MARKER_START}
## Beecork — Always-On Tools

You have Beecork MCP tools available when running inside Beecork:

- **beecork_remember** — Store facts in long-term memory (preferences, addresses, decisions)
- **beecork_recall** — Search memories. Call this at the start of complex tasks.
- **beecork_cron_create** — Schedule tasks: "at" (one-time), "every" (interval), "cron" (expression)
- **beecork_cron_list / beecork_cron_delete** — Manage scheduled tasks
- **beecork_tab_create / beecork_tab_list** — Manage virtual tabs
- **beecork_send_message** — Send message to another tab
- **beecork_notify** — Notify the user mid-task without stopping
- **beecork_status** — Check system status

When running unattended: always call beecork_recall first, always beecork_remember important outcomes, use beecork_notify for progress on long tasks.
${BEECORK_MARKER_END}`;

function injectClaudeMd(): void {
  const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
  const claudeDir = path.dirname(claudeMdPath);
  fs.mkdirSync(claudeDir, { recursive: true });

  let content = '';
  if (fs.existsSync(claudeMdPath)) {
    content = fs.readFileSync(claudeMdPath, 'utf-8');

    // Remove old injection if present
    const startIdx = content.indexOf(BEECORK_MARKER_START);
    const endIdx = content.indexOf(BEECORK_MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + content.slice(endIdx + BEECORK_MARKER_END.length);
      content = content.trim();
    }
  }

  // Append Beecork section
  content = content + '\n\n' + BEECORK_CLAUDE_MD + '\n';
  fs.writeFileSync(claudeMdPath, content);
}
