import { execAsync } from '../tasks/scheduler.js';
import type { Watcher } from './types.js';

export async function evaluateWatcher(watcher: Watcher): Promise<{ triggered: boolean; output: string }> {
  try {
    const { stdout } = await execAsync(watcher.checkCommand, { timeout: 30000 });
    const trimmed = stdout.trim();
    const output = trimmed.length > 10240 ? trimmed.slice(0, 10240) + ' [truncated]' : trimmed;

    const triggered = evaluateCondition(output, watcher.condition);
    return { triggered, output };
  } catch (err) {
    if (watcher.condition === 'error' || watcher.condition === 'any') {
      return { triggered: true, output: `Check failed: ${err}` };
    }
    // Command failed but condition isn't 'error' — log warning, don't trigger
    return { triggered: false, output: `Check failed: ${err}` };
  }
}

function evaluateCondition(output: string, condition: string): boolean {
  if (condition.startsWith('contains ')) return output.includes(condition.slice(9).trim());
  if (condition.startsWith('not contains ')) return !output.includes(condition.slice(13).trim());
  if (condition.startsWith('> ')) {
    const num = parseFloat(output);
    const threshold = parseFloat(condition.slice(2));
    if (Number.isNaN(num)) { return true; } // Can't parse = something's wrong = trigger
    return num > threshold;
  }
  if (condition.startsWith('< ')) {
    const num = parseFloat(output);
    const threshold = parseFloat(condition.slice(2));
    if (Number.isNaN(num)) { return true; }
    return num < threshold;
  }
  if (condition === 'any') return output.length > 0;
  if (condition === 'error') return false; // Only triggers on command failure (caught above)
  // Default: check if output is non-empty and not "ok"
  return output.length > 0 && output.toLowerCase() !== 'ok';
}
