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

program.parse();
