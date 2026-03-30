#!/usr/bin/env node
import { Command } from 'commander';
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

program
  .command('update')
  .description('Update beecork to the latest version')
  .option('--check', 'Check for updates without installing')
  .action(updateBeecork);

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

program.parse();
