#!/usr/bin/env node
import { Command } from 'commander';
import { platform } from 'node:os';
import { VERSION } from './version.js';
import { setupWizard } from './cli/setup.js';
import {
  startDaemon,
  stopDaemon,
  showStatus,
  listTabs,
  tailLogs,
  listCrons,
  deleteCron,
  listMemories,
  deleteMemory,
  sendMessage,
  updateBeecork,
} from './cli/commands.js';

const program = new Command();

program
  .name('beecork')
  .version(VERSION)
  .description('Claude Code always-on infrastructure — a phone number, a memory, and an alarm clock');

program
  .command('setup')
  .description('First-time setup wizard')
  .action(setupWizard);

program
  .command('start')
  .description('Start the Beecork daemon')
  .action(startDaemon);

program
  .command('stop')
  .description('Stop the Beecork daemon')
  .action(stopDaemon);

program
  .command('status')
  .description('Show daemon status, running tabs, and cron jobs')
  .action(showStatus);

program
  .command('tabs')
  .description('List all virtual tabs')
  .action(listTabs);

program
  .command('logs [tab]')
  .description('Tail logs for a tab (default: daemon logs)')
  .action(tailLogs);

const cronCmd = program
  .command('cron')
  .description('Manage cron jobs');

cronCmd
  .command('list')
  .description('List all cron jobs')
  .action(listCrons);

cronCmd
  .command('delete <id>')
  .description('Delete a cron job by ID')
  .action(deleteCron);

const memoryCmd = program
  .command('memory')
  .description('Manage long-term memories');

memoryCmd
  .command('list')
  .description('List stored memories')
  .action(listMemories);

memoryCmd
  .command('delete <id>')
  .description('Delete a memory by ID')
  .action(deleteMemory);

program
  .command('send <message>')
  .description('Send a message to the default tab (for testing)')
  .action(sendMessage);

const channelCmd = program
  .command('channel')
  .description('Manage community channel plugins');

channelCmd
  .command('install <package>')
  .description('Install a community channel (npm package)')
  .action(async (pkg: string) => {
    const { channelInstall } = await import('./cli/channel.js');
    channelInstall(pkg);
  });

channelCmd
  .command('create <name>')
  .description('Scaffold a new channel plugin')
  .action(async (name: string) => {
    const { channelCreate } = await import('./cli/channel.js');
    channelCreate(name);
  });

channelCmd
  .command('list')
  .description('List installed community channels')
  .action(async () => {
    const { channelList } = await import('./cli/channel.js');
    channelList();
  });

program
  .command('discord')
  .description('Configure Discord channel')
  .action(async () => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def?: string): Promise<string> => new Promise(r => rl.question(def ? `${q} [${def}]: ` : `${q}: `, a => r(a.trim() || def || '')));

    console.log('\nDiscord Setup\n');
    console.log('  1. Go to https://discord.com/developers/applications');
    console.log('  2. Click "New Application", give it a name');
    console.log('  3. Go to Bot → click "Add Bot"');
    console.log('  4. Copy the bot token');
    console.log('  5. Under Bot → enable "Message Content Intent"');
    console.log('  6. Use OAuth2 URL Generator to invite bot to your server\n');

    const token = await ask('Discord bot token');
    if (!token) { console.log('No token provided. Cancelled.'); rl.close(); return; }

    const userId = await ask('Your Discord user ID');

    const { getConfig, saveConfig } = await import('./config.js');
    const config = getConfig();
    (config as any).discord = { token, allowedUserIds: userId ? [userId] : [] };
    saveConfig(config);
    console.log('\n✓ Discord configured. Restart daemon: beecork stop && beecork start\n');
    rl.close();
  });

program
  .command('whatsapp')
  .description('Configure WhatsApp channel')
  .action(async () => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def?: string): Promise<string> => new Promise(r => rl.question(def ? `${q} [${def}]: ` : `${q}: `, a => r(a.trim() || def || '')));

    console.log('\nWhatsApp Setup\n');
    console.log('  WhatsApp connects via QR code scanning (like WhatsApp Web).');
    console.log('  When you start the daemon, a QR code will appear in the terminal.');
    console.log('  Scan it with your phone to link.\n');

    const number = await ask('Your WhatsApp phone number (e.g., 14155551234)');
    if (!number) { console.log('No number provided. Cancelled.'); rl.close(); return; }

    const { getConfig, saveConfig } = await import('./config.js');
    const { getBeecorkHome } = await import('./util/paths.js');
    const config = getConfig();
    (config as any).whatsapp = {
      enabled: true,
      mode: 'baileys',
      sessionPath: `${getBeecorkHome()}/whatsapp-session`,
      allowedNumbers: [number],
    };
    saveConfig(config);
    console.log('\n✓ WhatsApp configured. Restart daemon to scan QR: beecork stop && beecork start\n');
    rl.close();
  });

program
  .command('webhook')
  .description('Configure Webhook channel')
  .action(async () => {
    const readline = await import('node:readline');
    const crypto = await import('node:crypto');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string, def?: string): Promise<string> => new Promise(r => rl.question(def ? `${q} [${def}]: ` : `${q}: `, a => r(a.trim() || def || '')));

    console.log('\nWebhook Setup\n');
    console.log('  Webhooks let any service trigger Beecork via HTTP.');
    console.log('  Send POST requests to: http://localhost:PORT/webhook/tabName\n');

    const port = await ask('Port', '8374');
    const tokenInput = await ask('Auth token (Enter to auto-generate)');
    const token = tokenInput || crypto.randomBytes(24).toString('base64url');

    const { getConfig, saveConfig } = await import('./config.js');
    const config = getConfig();
    (config as any).webhook = { enabled: true, port: parseInt(port), authToken: token };
    saveConfig(config);
    console.log(`\n✓ Webhook enabled on port ${port}`);
    console.log(`  Auth token: ${token}`);
    console.log(`  Example: curl -X POST http://localhost:${port}/webhook/default -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"prompt":"hello"}'`);
    console.log('\n  Restart daemon: beecork stop && beecork start\n');
    rl.close();
  });

program
  .command('quickstart')
  .description('Print a getting-started checklist')
  .action(() => {
    const os = platform();
    console.log(`
Beecork Quickstart
==================

1. Install Claude Code (if not installed):
   npm install -g @anthropic-ai/claude-code

2. Run the setup wizard:
   beecork setup

3. Start the daemon:
   beecork start

4. Send a message on Telegram to your bot

5. Check status:
   beecork status

Useful commands:
  beecork tabs      \u2014 List active tabs
  beecork logs      \u2014 View daemon logs
  beecork doctor    \u2014 Run diagnostics
  beecork dashboard \u2014 Open web dashboard
  beecork cron list \u2014 View scheduled tasks

${os === 'darwin' ? 'On macOS: beecork runs as a launchd service.\n  Check: launchctl list | grep beecork' : ''}${os === 'linux' ? 'On Linux: beecork runs as a systemd service.\n  Check: systemctl --user status beecork' : ''}
    `);
  });

program
  .command('update')
  .description('Update beecork to the latest version')
  .option('--check', 'Check for updates without installing')
  .action(updateBeecork);

program
  .command('templates')
  .description('List configured tab templates')
  .action(async () => {
    const { getConfig } = await import('./config.js');
    const config = getConfig();
    const templates = config.tabTemplates || {};
    const entries = Object.entries(templates);
    if (entries.length === 0) {
      console.log('No tab templates configured.');
      console.log('Add templates in ~/.beecork/config.json under "tabTemplates"');
      return;
    }
    console.log(`\n${entries.length} template(s):\n`);
    for (const [name, tmpl] of entries) {
      console.log(`  ${name}:`);
      if (tmpl.workingDir) console.log(`    workingDir: ${tmpl.workingDir}`);
      if (tmpl.systemPrompt) console.log(`    systemPrompt: "${tmpl.systemPrompt.slice(0, 80)}${tmpl.systemPrompt.length > 80 ? '...' : ''}"`);
      if (tmpl.approvalMode) console.log(`    approvalMode: ${tmpl.approvalMode}`);
    }
    console.log('');
  });

program
  .command('dashboard')
  .description('Open the Beecork dashboard in your browser')
  .option('-p, --port <port>', 'Port to listen on (default: random)')
  .action(async (options) => {
    const { startDashboardServer } = await import('./dashboard/server.js');
    startDashboardServer(options.port ? parseInt(options.port) : 0);
  });

program
  .command('doctor')
  .description('Run diagnostic checks on your BeeCork installation')
  .action(async () => {
    const { runDoctor } = await import('./cli/doctor.js');
    await runDoctor();
  });

const mcpCmd = program
  .command('mcp')
  .description('Manage MCP server configurations');

mcpCmd
  .command('add <name> <command> [args...]')
  .description('Register an MCP server')
  .action(async (name: string, command: string, args: string[]) => {
    const { mcpAdd } = await import('./cli/mcp.js');
    mcpAdd(name, command, args);
  });

mcpCmd
  .command('remove <name>')
  .description('Unregister an MCP server')
  .action(async (name: string) => {
    const { mcpRemove } = await import('./cli/mcp.js');
    mcpRemove(name);
  });

mcpCmd
  .command('list')
  .description('List configured MCP servers')
  .action(async () => {
    const { mcpList } = await import('./cli/mcp.js');
    mcpList();
  });

program
  .command('export <tab>')
  .description('Export a tab session for handoff to terminal')
  .action(async (tab: string) => {
    const { exportTab, formatHandoffInfo } = await import('./cli/handoff.js');
    const info = exportTab(tab);
    if (!info) {
      console.error(`Tab "${tab}" not found.`);
      process.exit(1);
    }
    console.log(formatHandoffInfo(info));
  });

program
  .command('attach <tab>')
  .description('Attach to a tab session in your terminal (resume Claude Code)')
  .action(async (tab: string) => {
    const { attachTab } = await import('./cli/handoff.js');
    attachTab(tab);
  });

program
  .command('activity [hours]')
  .description('Show activity summary')
  .action(async (hours?: string) => {
    const h = parseInt(hours || '24');
    const { getActivitySummary, formatActivitySummary } = await import('./observability/analytics.js');
    console.log(formatActivitySummary(getActivitySummary(h)));
  });

program
  .command('machines')
  .description('List registered machines')
  .action(async () => {
    const { listMachines } = await import('./machines/index.js');
    const machines = listMachines();
    if (machines.length === 0) {
      console.log('No machines registered. Start the daemon to register this machine.');
      return;
    }
    console.log(`\n${machines.length} machine(s):\n`);
    for (const m of machines) {
      const primary = m.isPrimary ? ' (primary)' : '';
      const remote = m.host ? ` — ${m.sshUser}@${m.host}` : ' — local';
      console.log(`  ${m.name}${primary}${remote}`);
      for (const p of m.projectPaths) {
        console.log(`    ${p}`);
      }
    }
    console.log('');
  });

program.parse();
