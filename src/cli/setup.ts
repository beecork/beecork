import readline from 'node:readline';
import crypto from 'node:crypto';
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
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
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
    let claudeCodeMissing = false;
    console.log('Checking prerequisites...\n');
    try {
      const version = execSync('claude --version 2>&1', { encoding: 'utf-8' }).trim();
      console.log(`  \u2713 Claude Code found: ${version}`);
    } catch {
      claudeCodeMissing = true;
      console.log('  \u2717 Claude Code is not installed yet.');
      console.log('');
      console.log('    Claude Code is the AI brain that Beecork connects to.');
      console.log('    You need a Claude Pro or Max subscription ($20/month) from anthropic.com');
      console.log('    Then install it: npm install -g @anthropic-ai/claude-code');
      console.log('');
      console.log('    You can continue setup now and install Claude Code afterwards.');
      console.log('    Beecork will remind you at the end.');
      console.log('');
      console.log('    Guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md#prerequisites');
    }
    console.log('');

    // 1. Telegram token with step-by-step instructions
    console.log('Step 1: Create a Telegram Bot');
    console.log('');
    console.log('  A Telegram bot is your personal AI phone number.');
    console.log('  Only you can talk to it — nobody else can access your Claude.');
    console.log('');
    console.log('  How to create one:');
    console.log('  1. Open Telegram on your phone');
    console.log('  2. Search for @BotFather (it has a blue checkmark)');
    console.log('  3. Tap "Start" and then send: /newbot');
    console.log('  4. Choose a display name (e.g., "My Beecork")');
    console.log('  5. Choose a username ending in "bot" (e.g., "mybeecork_bot")');
    console.log('  6. BotFather will reply with a token — copy it');
    console.log('');
    console.log('  Detailed guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md\n');

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
    console.log('');
    console.log('  Your user ID tells Beecork who is allowed to use the bot.');
    console.log('  Without it, anyone who finds your bot could use your Claude.');
    console.log('');
    console.log('  How to find it:');
    console.log('  1. Search for @userinfobot on Telegram');
    console.log('  2. Tap "Start" and send it any message');
    console.log('  3. It replies with your user ID (a number like 123456789)');
    console.log('');
    console.log('  Detailed guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md\n');

    const userIdStr = await ask(rl, 'Your Telegram user ID');
    const userId = parseInt(userIdStr, 10);
    if (isNaN(userId)) {
      console.log('Invalid user ID. Must be a number.');
      return;
    }

    const claudeBin = findClaudeBin();
    const defaultDir = os.homedir();
    const scanPaths = ['~/Coding', '~/Projects', '~/code', '~/dev'];

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
        computerUse: false,
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
        enabled: false,
        anthropicApiKey: '',
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
    {
      try {
        const servicePath = installService();
        console.log(`✓ Service installed at ${servicePath}`);
      } catch (err) {
        console.log(`⚠ Service install failed: ${err instanceof Error ? err.message : err}`);
        console.log('  You can start beecork manually with: beecork start');
      }
    }

    console.log('\n✅ Setup complete!\n');

    if (claudeCodeMissing) {
      console.log('  ⚠️  IMPORTANT: Install Claude Code before starting the daemon:');
      console.log('');
      console.log('     npm install -g @anthropic-ai/claude-code');
      console.log('');
      console.log('     You also need a Claude Pro or Max subscription ($20/month).');
      console.log('     Sign up at: https://claude.ai');
      console.log('     Guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md#prerequisites');
      console.log('');
    }

    console.log('  Next steps:');
    console.log('    1. Start the daemon:  beecork start');
    console.log('    2. Send a message to your Telegram bot');
    console.log('    3. Check status:      beecork status');
    console.log('');
    console.log('  Useful commands:');
    console.log('    beecork doctor     — check if everything is working');
    console.log('    beecork dashboard  — open web control panel');
    console.log('    beecork quickstart — full getting-started checklist');
    console.log('');

    console.log('  ★ Recommended: Smart project routing');
    console.log('    If you work on multiple projects, Beecork can auto-detect which');
    console.log('    project you mean and route messages to the right tab.');
    console.log('    Run: beecork pipe setup');
    console.log('');
    console.log('  Add more channels:');
    console.log('    beecork whatsapp           — connect WhatsApp');
    console.log('    beecork discord            — connect Discord');
    console.log('    beecork webhook            — enable webhook API');
    console.log('');
    console.log('  Add more features:');
    console.log('    beecork media setup        — image, video, audio generation');
    console.log('    beecork enable github      — repos, PRs, issues');
    console.log('    beecork enable notion      — pages, databases, notes');
    console.log('    beecork computer-use enable — mouse, keyboard, screen control');
    console.log('');

    console.log('  Need help? https://github.com/beecork/beecork/blob/main/docs/troubleshooting.md\n');

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

**Memory:** beecork_remember, beecork_recall — store and search long-term memory
**Scheduling:** beecork_task_create/list/delete — schedule recurring tasks (aliases: beecork_cron_*)
**Watchers:** beecork_watch_create/list/delete — monitor conditions and auto-respond
**Tabs:** beecork_tab_create/list, beecork_send_message — manage virtual tabs
**Communication:** beecork_notify, beecork_send_media — notify user, send files
**Delegation:** beecork_delegate, beecork_delegation_status — delegate tasks to other tabs
**Media:** beecork_generate_image/video/audio — generate media via AI providers
**Projects:** beecork_project_create/list — manage projects
**Observability:** beecork_cost, beecork_activity, beecork_status — track spending and activity
**Handoff:** beecork_handoff — export session for terminal resume

### Self-Extension

You can install new capabilities for yourself. If the user asks for a tool or media provider that isn't configured:

1. Check if a community package exists: \`beecork-media-<name>\` or \`beecork-channel-<name>\` on npm
2. Install it: \`npm install -g beecork-media-<name>\`
3. Or create a custom MCP server: write a Node.js script wrapping the API, register in \`~/.beecork/mcp-config.json\`
4. Tell the user to restart: \`beecork stop && beecork start\`

### Guidelines

- Always call beecork_recall at the start of complex tasks
- Always beecork_remember important outcomes and decisions
- Use beecork_notify for progress on long tasks
- Use beecork_delegate for independent subtasks that need their own workspace
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
