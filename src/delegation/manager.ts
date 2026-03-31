import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';

const MAX_DELEGATION_DEPTH = 3;
const MAX_PENDING_PER_TAB = 5;

export interface Delegation {
  id: string;
  sourceTab: string;
  targetTab: string;
  message: string;
  returnToTab: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: string | null;
  depth: number;
  createdAt: string;
  completedAt: string | null;
}

/** Create a new delegation */
export function createDelegation(sourceTab: string, targetTab: string, message: string, returnToTab?: string): Delegation {
  const db = getDb();

  // Check depth limit
  const sourceDepth = getCurrentDepth(sourceTab);
  if (sourceDepth >= MAX_DELEGATION_DEPTH) {
    throw new Error(`Delegation depth limit reached (max ${MAX_DELEGATION_DEPTH}). Tab "${sourceTab}" cannot delegate further.`);
  }

  // Check pending limit
  const pending = (db.prepare(
    "SELECT COUNT(*) as c FROM delegations WHERE source_tab = ? AND status IN ('pending', 'running')"
  ).get(sourceTab) as { c: number }).c;
  if (pending >= MAX_PENDING_PER_TAB) {
    throw new Error(`Too many pending delegations for tab "${sourceTab}" (max ${MAX_PENDING_PER_TAB}).`);
  }

  const id = uuidv4();
  const delegation: Delegation = {
    id,
    sourceTab,
    targetTab,
    message,
    returnToTab: returnToTab || sourceTab,
    status: 'pending',
    result: null,
    depth: sourceDepth + 1,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };

  db.prepare(
    'INSERT INTO delegations (id, source_tab, target_tab, message, return_to_tab, status, depth) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sourceTab, targetTab, message, delegation.returnToTab, 'pending', delegation.depth);

  logger.info(`Delegation created: ${sourceTab} → ${targetTab} (depth ${delegation.depth})`);
  return delegation;
}

/** Mark a delegation as running */
export function markDelegationRunning(id: string): void {
  getDb().prepare("UPDATE delegations SET status = 'running' WHERE id = ?").run(id);
}

/** Complete a delegation with a result */
export function completeDelegation(targetTab: string, result: string): Delegation | null {
  const db = getDb();

  // Find the most recent pending/running delegation to this tab
  const row = db.prepare(
    "SELECT * FROM delegations WHERE target_tab = ? AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1"
  ).get(targetTab) as any;

  if (!row) return null;

  db.prepare(
    "UPDATE delegations SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(result.slice(0, 50000), row.id); // Cap result at 50KB

  logger.info(`Delegation completed: ${row.source_tab} → ${row.target_tab}`);

  return {
    id: row.id,
    sourceTab: row.source_tab,
    targetTab: row.target_tab,
    message: row.message,
    returnToTab: row.return_to_tab,
    status: 'completed',
    result,
    depth: row.depth,
    createdAt: row.created_at,
    completedAt: new Date().toISOString(),
  };
}

/** Get pending delegations for a tab */
export function getPendingDelegations(tabName?: string): Delegation[] {
  const db = getDb();
  const query = tabName
    ? "SELECT * FROM delegations WHERE source_tab = ? AND status IN ('pending', 'running') ORDER BY created_at"
    : "SELECT * FROM delegations WHERE status IN ('pending', 'running') ORDER BY created_at";
  const rows = tabName ? db.prepare(query).all(tabName) : db.prepare(query).all();
  return (rows as any[]).map(r => ({
    id: r.id,
    sourceTab: r.source_tab,
    targetTab: r.target_tab,
    message: r.message,
    returnToTab: r.return_to_tab,
    status: r.status,
    result: r.result,
    depth: r.depth,
    createdAt: r.created_at,
    completedAt: r.completed_at,
  }));
}

/** Get current delegation depth for a tab */
function getCurrentDepth(tabName: string): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT MAX(depth) as d FROM delegations WHERE source_tab = ? AND status IN ('pending', 'running')"
  ).get(tabName) as { d: number | null };
  return row.d ?? 0;
}
