import { execAsync } from '../tasks/scheduler.js';
import type { Watcher } from './types.js';

export async function evaluateWatcher(watcher: Watcher): Promise<{ triggered: boolean; output: string }> {
  try {
    const { stdout } = await execAsync(watcher.checkCommand, { timeout: 30000 });
    const output = stdout.trim();

    const triggered = evaluateCondition(output, watcher.condition);
    return { triggered, output };
  } catch (err) {
    // Command failed -- might itself be the trigger (e.g., server not responding)
    return { triggered: true, output: `Check failed: ${err}` };
  }
}

function evaluateCondition(output: string, condition: string): boolean {
  if (condition.startsWith('contains ')) return output.includes(condition.slice(9));
  if (condition.startsWith('not contains ')) return !output.includes(condition.slice(13));
  if (condition.startsWith('> ')) return parseFloat(output) > parseFloat(condition.slice(2));
  if (condition.startsWith('< ')) return parseFloat(output) < parseFloat(condition.slice(2));
  if (condition === 'any') return output.length > 0;
  if (condition === 'error') return false; // Only triggers on command failure (caught above)
  // Default: check if output is non-empty and not "ok"
  return output.length > 0 && output.toLowerCase() !== 'ok';
}
