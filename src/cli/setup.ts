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
import { CAPABILITY_PACKS } from '../capabilities/packs.js';
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

export async function setupWizard(mode: 'quick' | 'full' = 'quick'): Promise<void> {
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

    // Quick mode defaults
    let claudeBin = findClaudeBin();
    let defaultDir = os.homedir();
    let enableComputerUse = 'n';
    let apiKey = '';
    let scanPaths = ['~/Coding', '~/Projects', '~/code', '~/dev'];
    let shouldInstallService = true;
    const enabledCaps: Array<{ packId: string; apiKey?: string }> = [];

    if (mode === 'full') {
      // 3. Claude binary path
      const defaultBin = findClaudeBin();
      claudeBin = await ask(rl, 'Path to claude binary', defaultBin);

      // 4. Default working directory
      defaultDir = await ask(rl, 'Default working directory', os.homedir());

      // 5. Computer use (optional)
      console.log('\n  Computer use (optional): Allow Claude to control your mouse, keyboard,');
      console.log('  and screen. This lets Beecork use any app on your computer — browsers,');
      console.log('  spreadsheets, design tools, internal dashboards. Powerful but requires');
      console.log('  granting screen recording and accessibility permissions.');
      console.log('  Guide: https://github.com/beecork/beecork/blob/main/docs/troubleshooting.md\n');
      enableComputerUse = await ask(rl, 'Enable computer use? (y/n)', 'n');

      // 6. Anthropic API key (optional - enables intelligent pipe)
      console.log('\n  Intelligent routing (optional): Beecork can route messages to the right');
      console.log('  project automatically and track goal completion. Requires an Anthropic API key.');
      apiKey = await ask(rl, 'Anthropic API key (press Enter to skip)');

      // 6. Project scan paths
      if (apiKey) {
        const scanInput = await ask(rl, 'Project scan paths (comma-separated)', scanPaths.join(', '));
        scanPaths = scanInput.split(',').map(s => s.trim()).filter(Boolean);
      }

      // 7. Install as service?
      const installServiceAnswer = await ask(rl, 'Install as background service? (y/n)', 'y');
      shouldInstallService = installServiceAnswer.toLowerCase() === 'y';
    }

    // Offer full setup at end of quick mode
    let showExtras = mode === 'full';
    if (mode === 'quick') {
      console.log('\n  ✓ Telegram is ready!\n');
      const wantMore = await ask(rl, 'Configure additional features? (Discord, WhatsApp, media, capabilities) (y/n)', 'n');
      if (wantMore.toLowerCase() === 'y') {
        showExtras = true;
      }
    }

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
        computerUse: enableComputerUse.toLowerCase() === 'y',
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

    if (showExtras) {
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
        console.log('  Detailed guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md\n');

        const discordToken = await ask(rl, 'Discord bot token (or press Enter to skip)');
        if (discordToken) {
          const discordUserId = await ask(rl, 'Your Discord user ID (right-click your name → Copy User ID)');
          config.discord = {
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
        console.log('  Guide: https://github.com/beecork/beecork/blob/main/docs/getting-started.md\n');

        const waNumber = await ask(rl, 'Your WhatsApp phone number (e.g., 14155551234)');
        if (waNumber) {
          config.whatsapp = {
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
        config.webhook = {
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

        console.log('\nImage: 1) Nano Banana (Google)  2) DALL-E (OpenAI)  3) Stable Diffusion  4) Recraft (Vectors)');
        const imgChoice = await ask(rl, 'Choose image provider (1/2/3/4 or Enter to skip)');
        if (imgChoice === '1') {
          const key = await ask(rl, '  Google AI API key (from ai.google.dev)');
          if (key) mediaGenerators.push({ provider: 'nano-banana', apiKey: key });
        } else if (imgChoice === '2') {
          const key = await ask(rl, '  OpenAI API key');
          if (key) mediaGenerators.push({ provider: 'dall-e', apiKey: key });
        } else if (imgChoice === '3') {
          const key = await ask(rl, '  Stability AI API key');
          if (key) mediaGenerators.push({ provider: 'stable-diffusion', apiKey: key });
        } else if (imgChoice === '4') {
          const key = await ask(rl, '  Recraft API key');
          if (key) mediaGenerators.push({ provider: 'recraft', apiKey: key });
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

        console.log('\nAudio/Music: 1) ElevenLabs Music  2) Google Lyria  3) ElevenLabs SFX');
        const audChoice = await ask(rl, 'Choose audio provider (1/2/3 or Enter to skip)');
        if (audChoice === '1') {
          const key = await ask(rl, '  ElevenLabs API key (xi-...)');
          if (key) mediaGenerators.push({ provider: 'elevenlabs-music', apiKey: key });
        } else if (audChoice === '2') {
          const key = await ask(rl, '  Google AI API key (from ai.google.dev)');
          if (key) mediaGenerators.push({ provider: 'lyria', apiKey: key });
        } else if (audChoice === '3') {
          const key = await ask(rl, '  ElevenLabs API key (xi-...)');
          if (key) mediaGenerators.push({ provider: 'elevenlabs-sfx', apiKey: key });
        }

        if (mediaGenerators.length > 0) {
          config.mediaGenerators = mediaGenerators;
          console.log(`\n  ✓ ${mediaGenerators.length} media provider(s) configured`);
        }
      }

      // Capabilities
      console.log('\nOptional: Capabilities\n');
      console.log('Pre-configured integrations for common tasks.');
      console.log('You can add these later with: beecork enable <name>\n');

      const capPacks = ['email', 'calendar', 'github', 'notion', 'drive', 'web', 'database'];
      const capNames: Record<string, string> = {
        email: 'Email (Gmail)',
        calendar: 'Calendar (Google)',
        github: 'GitHub',
        notion: 'Notion',
        drive: 'Google Drive',
        web: 'Web Browsing',
        database: 'Database (PostgreSQL)',
      };

      for (const packId of capPacks) {
        const pack = CAPABILITY_PACKS.find(p => p.id === packId);
        if (!pack) continue;
        const answer = await ask(rl, `Enable ${capNames[packId]}? (y/n)`, 'n');
        if (answer.toLowerCase() === 'y' && pack.requiresApiKey) {
          const key = await ask(rl, `  ${pack.apiKeyHint}`);
          if (key) {
            enabledCaps.push({ packId, apiKey: key });
          }
        } else if (answer.toLowerCase() === 'y') {
          enabledCaps.push({ packId });
        }
      }

      console.log('You can add or change channels later with:');
      console.log('  beecork discord    — add/reconfigure Discord');
      console.log('  beecork whatsapp   — add/reconfigure WhatsApp');
      console.log('  beecork dashboard  — manage everything from the web UI\n');
    }

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

    // Enable capabilities
    if (enabledCaps.length > 0) {
      const { enablePack } = await import('../capabilities/index.js');
      for (const cap of enabledCaps) {
        try {
          enablePack(cap.packId, cap.apiKey);
          console.log(`✓ ${cap.packId} enabled`);
        } catch (err) {
          console.log(`⚠ Failed to enable ${cap.packId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

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

    if (!showExtras) {
      console.log('  Add more features anytime:');
      console.log('    beecork enable email      — manage your inbox');
      console.log('    beecork enable github     — repos, PRs, issues');
      console.log('    beecork enable calendar   — schedule meetings');
      console.log('    beecork capabilities      — see all options');
      console.log('    beecork setup --full      — full guided setup');
      console.log('');
    }

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
