import { execSync } from 'node:child_process';
import { logger } from '../util/logger.js';
import type { Machine } from './registry.js';

/**
 * Forward a message to a remote Beecork instance via SSH.
 * Writes to the remote machine's pending_messages table.
 */
export async function forwardToMachine(machine: Machine, tabName: string, message: string): Promise<boolean> {
  if (!machine.host || !machine.sshUser) {
    logger.warn(`Cannot forward to ${machine.name}: no SSH config`);
    return false;
  }

  try {
    // Use the remote beecork CLI to send the message
    const escapedMessage = message.replace(/'/g, "'\\''");
    const cmd = `ssh ${machine.sshUser}@${machine.host} 'beecork send "${tabName}" '"'"'${escapedMessage}'"'"''`;

    execSync(cmd, { timeout: 30000, encoding: 'utf-8' });
    logger.info(`Message forwarded to ${machine.name} (${machine.host}), tab: ${tabName}`);
    return true;
  } catch (err) {
    logger.error(`Failed to forward to ${machine.name}:`, err);
    return false;
  }
}
