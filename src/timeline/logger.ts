import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import type { EventType } from './types.js';

export function logActivity(eventType: EventType, summary: string, options?: {
  projectName?: string;
  tabName?: string;
  details?: string;
  durationMs?: number;
  costUsd?: number;
}): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO activity_log (id, event_type, project_name, tab_name, summary, details, duration_ms, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      uuidv4(), eventType, options?.projectName || null, options?.tabName || null,
      summary, options?.details || null, options?.durationMs || null, options?.costUsd || null
    );
  } catch { /* non-critical — don't crash if logging fails */ }
}
