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

program.parse();
