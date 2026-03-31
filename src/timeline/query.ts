import { getDb } from '../db/index.js';
import type { ActivityEvent } from './types.js';

interface ActivityRow {
  id: string; event_type: string; project_name: string | null; tab_name: string | null;
  summary: string; details: string | null; duration_ms: number | null; cost_usd: number | null;
  created_at: string;
}

function rowToEvent(r: ActivityRow): ActivityEvent {
  return {
    id: r.id, eventType: r.event_type as any, projectName: r.project_name,
    tabName: r.tab_name, summary: r.summary, details: r.details,
    durationMs: r.duration_ms, costUsd: r.cost_usd, createdAt: r.created_at,
  };
}

export function getTimeline(options?: { date?: string; tabName?: string; limit?: number }): ActivityEvent[] {
  const db = getDb();
  let query = 'SELECT * FROM activity_log';
  const conditions: string[] = [];
  const params: any[] = [];

  if (options?.date) {
    conditions.push('date(created_at) = ?');
    params.push(options.date);
  }
  if (options?.tabName) {
    conditions.push('tab_name = ?');
    params.push(options.tabName);
  }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY created_at DESC';
  query += ` LIMIT ${options?.limit || 50}`;

  return (db.prepare(query).all(...params) as ActivityRow[]).map(rowToEvent);
}

export function formatTimeline(events: ActivityEvent[]): string {
  if (events.length === 0) return 'No activity recorded.';

  const byDate = new Map<string, ActivityEvent[]>();
  for (const event of events.reverse()) {
    const date = event.createdAt.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date)!.push(event);
  }

  const lines: string[] = [];
  for (const [date, dayEvents] of byDate) {
    lines.push(`\n📅 ${date}`);
    for (const e of dayEvents) {
      const time = e.createdAt.slice(11, 16);
      const tab = e.tabName ? `[${e.tabName}]` : '';
      const cost = e.costUsd ? ` $${e.costUsd.toFixed(4)}` : '';
      lines.push(`  ${time}  ${tab} ${e.summary}${cost}`);
    }
  }
  return lines.join('\n');
}

export function getReplayInfo(eventId: string): { tabName: string; message: string } | null {
  const db = getDb();
  const event = db.prepare('SELECT * FROM activity_log WHERE id = ?').get(eventId) as ActivityRow | undefined;
  if (!event || !event.tab_name || !event.details) return null;
  return { tabName: event.tab_name, message: event.details };
}
