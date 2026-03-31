import os from 'node:os';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { getBeecorkHome } from '../util/paths.js';
import { logger } from '../util/logger.js';
import fs from 'node:fs';

export interface Machine {
  id: string;
  name: string;
  host: string | null;
  sshUser: string | null;
  projectPaths: string[];
  isPrimary: boolean;
  lastSeenAt: string;
}

const MACHINE_ID_PATH = `${getBeecorkHome()}/machine-id`;

/** Get or create this machine's unique ID */
export function getMachineId(): string {
  if (fs.existsSync(MACHINE_ID_PATH)) {
    return fs.readFileSync(MACHINE_ID_PATH, 'utf-8').trim();
  }
  const id = uuidv4();
  fs.writeFileSync(MACHINE_ID_PATH, id, { mode: 0o600 });
  return id;
}

/** Register this machine in the database */
export function registerThisMachine(projectPaths: string[]): Machine {
  const db = getDb();
  const id = getMachineId();
  const name = os.hostname();

  db.prepare(`
    INSERT INTO machines (id, name, project_paths, last_seen_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      project_paths = excluded.project_paths,
      last_seen_at = datetime('now')
  `).run(id, name, JSON.stringify(projectPaths));

  logger.info(`Machine registered: ${name} (${id.slice(0, 8)}) with ${projectPaths.length} project paths`);
  return { id, name, host: null, sshUser: null, projectPaths, isPrimary: false, lastSeenAt: new Date().toISOString() };
}

/** Add a remote machine */
export function addRemoteMachine(name: string, host: string, sshUser: string, projectPaths: string[]): Machine {
  const db = getDb();
  const id = uuidv4();
  db.prepare(
    'INSERT INTO machines (id, name, host, ssh_user, project_paths) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, host, sshUser, JSON.stringify(projectPaths));
  return { id, name, host, sshUser, projectPaths, isPrimary: false, lastSeenAt: new Date().toISOString() };
}

/** Remove a machine */
export function removeMachine(nameOrId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM machines WHERE id = ? OR name = ?').run(nameOrId, nameOrId);
  return result.changes > 0;
}

/** List all machines */
export function listMachines(): Machine[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM machines ORDER BY is_primary DESC, name').all() as any[];
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    host: r.host,
    sshUser: r.ssh_user,
    projectPaths: JSON.parse(r.project_paths || '[]'),
    isPrimary: !!r.is_primary,
    lastSeenAt: r.last_seen_at,
  }));
}

/** Find which machine has a project path */
export function findMachineForPath(projectPath: string): Machine | null {
  const machines = listMachines();
  for (const machine of machines) {
    for (const p of machine.projectPaths) {
      if (projectPath.startsWith(p)) return machine;
    }
  }
  return null;
}
