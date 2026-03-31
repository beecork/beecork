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
      console.log('    Guide: https://support.beecork.com/claude-code-setup');
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
    console.log('  Detailed guide: https://support.beecork.com/telegram-setup\n');

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
    console.log('  Detailed guide: https://support.beecork.com/telegram-setup\n');

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

    // Optional: Additional channels
    console.log('\nOptional: Add more channels\n');
    console.log('You can also connect via WhatsApp, Discord, or Webhooks.');
    console.log('You can always add these later with: beecork discord, beecork whatsapp, etc.\n');

    const addDiscord = await ask(rl, 'Set up Discord? (y/n)', 'n');
    if (addDiscord.toLowerCase() === 'y') {
      console.log('\nDiscord Setup:');
      console.log('  1. Go to https://discord.com/developers/applications');
      console.log('  2. Click "New Application", give it a name');
      console.log('  3. Go to Bot → click "Add Bot"');
      console.log('  4. Copy the bot token');
      console.log('  5. Under Bot → enable "Message Content Intent"');
      console.log('  6. Use OAuth2 URL Generator to invite bot to your server');
      console.log('');
      console.log('  Detailed guide: https://support.beecork.com/discord-setup\n');

      const discordToken = await ask(rl, 'Discord bot token (or press Enter to skip)');
      if (discordToken) {
        const discordUserId = await ask(rl, 'Your Discord user ID (right-click your name → Copy User ID)');
        (config as any).discord = {
          token: discordToken,
          allowedUserIds: discordUserId ? [discordUserId] : [],
        };
        console.log('  ✓ Discord configured\n');
      }
    }

    const addWhatsApp = await ask(rl, 'Set up WhatsApp? (y/n)', 'n');
    if (addWhatsApp.toLowerCase() === 'y') {
      console.log('\nWhatsApp Setup:');
      console.log('  WhatsApp connects via QR code scanning (like WhatsApp Web).');
      console.log('  When you start the daemon, a QR code appears in the terminal.');
      console.log('  Scan it with your phone to link your WhatsApp account.');
      console.log('');
      console.log('  Note: This uses reverse-engineered WhatsApp Web protocol.');
      console.log('  For personal use only — not officially supported by WhatsApp.');
      console.log('');
      console.log('  Guide: https://support.beecork.com/whatsapp-setup\n');

      const waNumber = await ask(rl, 'Your WhatsApp phone number (e.g., 14155551234)');
      if (waNumber) {
        (config as any).whatsapp = {
          enabled: true,
          mode: 'baileys',
          sessionPath: `${getBeecorkHome()}/whatsapp-session`,
          allowedNumbers: [waNumber],
        };
        console.log('  ✓ WhatsApp configured (scan QR code when daemon starts)\n');
      }
    }

    const addWebhook = await ask(rl, 'Enable Webhook API? (y/n)', 'n');
    if (addWebhook.toLowerCase() === 'y') {
      const webhookPort = await ask(rl, 'Webhook port', '8374');
      const webhookToken = await ask(rl, 'Webhook auth token (press Enter to auto-generate)');
      const whToken = webhookToken || crypto.randomBytes(24).toString('base64url');
      (config as any).webhook = {
        enabled: true,
        port: parseInt(webhookPort),
        authToken: whToken,
      };
      console.log(`  ✓ Webhook enabled on port ${webhookPort}`);
      if (!webhookToken) console.log(`  Auth token: ${whToken}\n`);
    }

    // Optional: Media generation
    console.log('\nOptional: Media Generation\n');
    console.log('Beecork can generate images, videos, and music using AI providers.');
    console.log('You can add these later with: beecork media\n');

    const addMedia = await ask(rl, 'Set up media generation? (y/n)', 'n');
    if (addMedia.toLowerCase() === 'y') {
      const mediaGenerators: Array<{ provider: string; apiKey: string; model?: string }> = [];

      console.log('\nImage: 1) DALL-E (OpenAI)  2) Stable Diffusion');
      const imgChoice = await ask(rl, 'Choose image provider (1/2 or Enter to skip)');
      if (imgChoice === '1') {
        const key = await ask(rl, '  OpenAI API key');
        if (key) mediaGenerators.push({ provider: 'dall-e', apiKey: key });
      } else if (imgChoice === '2') {
        const key = await ask(rl, '  Stability AI API key');
        if (key) mediaGenerators.push({ provider: 'stable-diffusion', apiKey: key });
      }

      console.log('\nVideo: 1) Runway  2) Veo  3) Kling');
      const vidChoice = await ask(rl, 'Choose video provider (1/2/3 or Enter to skip)');
      if (vidChoice === '1') {
        const key = await ask(rl, '  Runway API key');
        if (key) mediaGenerators.push({ provider: 'runway', apiKey: key });
      } else if (vidChoice === '2') {
        const key = await ask(rl, '  Google AI API key');
        if (key) mediaGenerators.push({ provider: 'veo', apiKey: key });
      } else if (vidChoice === '3') {
        const key = await ask(rl, '  Kling API key');
        if (key) mediaGenerators.push({ provider: 'kling', apiKey: key });
      }

      console.log('\nAudio: 1) Suno (music)  2) ElevenLabs (sound effects)');
      const audChoice = await ask(rl, 'Choose audio provider (1/2 or Enter to skip)');
      if (audChoice === '1') {
        const key = await ask(rl, '  Suno API key');
        if (key) mediaGenerators.push({ provider: 'suno', apiKey: key });
      } else if (audChoice === '2') {
        const key = await ask(rl, '  ElevenLabs API key');
        if (key) mediaGenerators.push({ provider: 'elevenlabs-sfx', apiKey: key });
      }

      if (mediaGenerators.length > 0) {
        (config as any).mediaGenerators = mediaGenerators;
        console.log(`\n  ✓ ${mediaGenerators.length} media provider(s) configured`);
      }
    }

    console.log('You can add or change channels later with:');
    console.log('  beecork discord    — add/reconfigure Discord');
    console.log('  beecork whatsapp   — add/reconfigure WhatsApp');
    console.log('  beecork dashboard  — manage everything from the web UI\n');

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

    if (claudeCodeMissing) {
      console.log('  ⚠️  IMPORTANT: Install Claude Code before starting the daemon:');
      console.log('');
      console.log('     npm install -g @anthropic-ai/claude-code');
      console.log('');
      console.log('     You also need a Claude Pro or Max subscription ($20/month).');
      console.log('     Sign up at: https://claude.ai');
      console.log('     Guide: https://support.beecork.com/claude-code-setup');
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
    console.log('  Need help? https://support.beecork.com\n');

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
