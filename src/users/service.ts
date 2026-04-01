import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';

export interface User {
  id: string;
  name: string;
  role: 'admin' | 'user';
  budgetUsd: number | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  name: string;
  role: string;
  budget_usd: number | null;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return { id: row.id, name: row.name, role: row.role as 'admin' | 'user', budgetUsd: row.budget_usd, createdAt: row.created_at };
}

/** Get or create a user from a channel identity */
export function resolveUser(channelId: string, peerId: string): User | null {
  const db = getDb();
  const identity = db.prepare('SELECT user_id FROM identities WHERE channel_id = ? AND peer_id = ?').get(channelId, peerId) as { user_id: string } | undefined;
  if (!identity) return null;
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(identity.user_id) as UserRow | undefined;
  return row ? rowToUser(row) : null;
}

/** Register a new user */
export function registerUser(name: string, channelId: string, peerId: string, role: 'admin' | 'user' = 'user'): User {
  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, name, role) VALUES (?, ?, ?)').run(id, name, role);
  db.prepare('INSERT INTO identities (user_id, channel_id, peer_id) VALUES (?, ?, ?)').run(id, channelId, peerId);
  logger.info(`User registered: ${name} (${role}) via ${channelId}:${peerId}`);
  return { id, name, role, budgetUsd: null, createdAt: new Date().toISOString() };
}

/** Link an additional channel identity to an existing user */
export function linkIdentity(userId: string, channelId: string, peerId: string): boolean {
  const db = getDb();
  try {
    db.prepare('INSERT INTO identities (user_id, channel_id, peer_id) VALUES (?, ?, ?)').run(userId, channelId, peerId);
    return true;
  } catch {
    return false; // Already linked or conflict
  }
}

/** Get all users */
export function listUsers(): User[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[]).map(rowToUser);
}

/** Check if any admin exists */
export function hasAdmin(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
  return row.c > 0;
}

