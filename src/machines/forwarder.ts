import { execFileSync } from 'node:child_process';
import { logger } from '../util/logger.js';
import { validateTabName } from '../config.js';
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

  // Validate inputs to prevent injection via execFileSync args
  if (tabName !== 'default') {
    const tabError = validateTabName(tabName);
    if (tabError) {
      logger.error(`Invalid tab name for forwarding: ${tabError}`);
      return false;
    }
  }

  try {
    // Use execFileSync with array args to prevent shell injection
    execFileSync('ssh', [
      `${machine.sshUser}@${machine.host}`,
      'beecork', 'send', tabName, message,
    ], { timeout: 30000, encoding: 'utf-8' });

    logger.info(`Message forwarded to ${machine.name} (${machine.host}), tab: ${tabName}`);
    return true;
  } catch (err) {
    logger.error(`Failed to forward to ${machine.name}:`, err);
    return false;
  }
}
