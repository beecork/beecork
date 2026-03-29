import fs from 'node:fs';
import { getPidPath } from '../util/paths.js';

export { timeAgo } from '../util/text.js';

export function getDaemonPid(): number | null {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return null;
  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  if (isNaN(pid)) return null;

  // Check if process is actually running
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    // Stale PID file
    fs.unlinkSync(pidPath);
    return null;
  }
}
