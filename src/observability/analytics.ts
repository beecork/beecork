import { getDb } from '../db/index.js';

export interface CostSummary {
  today: number;
  last7Days: number;
  last30Days: number;
  perTab: Array<{ name: string; cost: number; messages: number }>;
}

export interface ActivitySummary {
  period: string;
  messagesReceived: number;
  messagesFromAssistant: number;
  cronJobsFired: number;
  memoriesCreated: number;
  totalCost: number;
  activeTabsCount: number;
}

export function getCostSummary(): CostSummary {
  const db = getDb();

  const today = (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now')").get() as any).total;
  const last7 = (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now', '-7 days')").get() as any).total;
  const last30 = (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now', '-30 days')").get() as any).total;

  const perTab = db.prepare(`
    SELECT t.name, COALESCE(SUM(m.cost_usd), 0) as cost, COUNT(m.id) as messages
    FROM tabs t LEFT JOIN messages m ON m.tab_id = t.id
    GROUP BY t.id ORDER BY cost DESC
  `).all() as Array<{ name: string; cost: number; messages: number }>;

  return { today, last7Days: last7, last30Days: last30, perTab };
}

export function getActivitySummary(hours: number = 24): ActivitySummary {
  const db = getDb();
  const sinceDate = new Date(Date.now() - hours * 3600000).toISOString();

  const messagesReceived = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE role = ? AND created_at > ?').get('user', sinceDate) as any).c;
  const messagesFromAssistant = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE role = ? AND created_at > ?').get('assistant', sinceDate) as any).c;
  const cronJobsFired = (db.prepare('SELECT COUNT(*) as c FROM tasks WHERE last_run_at > ?').get(sinceDate) as any).c;
  const memoriesCreated = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE created_at > ?').get(sinceDate) as any).c;
  const totalCost = (db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > ?').get(sinceDate) as any).total;
  const activeTabsCount = (db.prepare('SELECT COUNT(DISTINCT tab_id) as c FROM messages WHERE created_at > ?').get(sinceDate) as any).c;

  return {
    period: `Last ${hours} hours`,
    messagesReceived,
    messagesFromAssistant,
    cronJobsFired,
    memoriesCreated,
    totalCost,
    activeTabsCount,
  };
}

export function checkAnomalies(): string | null {
  const db = getDb();

  // Today's spend
  const todaySpend = (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE created_at > date('now')").get() as any).total;

  // 7-day rolling average (excluding today)
  const avgSpend = (db.prepare(`
    SELECT COALESCE(AVG(daily_total), 0) as avg FROM (
      SELECT date(created_at) as day, SUM(cost_usd) as daily_total
      FROM messages
      WHERE created_at > date('now', '-7 days') AND created_at < date('now')
      GROUP BY date(created_at)
    )
  `).get() as any).avg;

  if (avgSpend > 0 && todaySpend > avgSpend * 2) {
    return `⚠️ Anomaly: Today's spend ($${todaySpend.toFixed(4)}) exceeds 2x your 7-day average ($${avgSpend.toFixed(4)}/day)`;
  }

  return null;
}

export function formatCostSummary(summary: CostSummary): string {
  const lines = [
    `💰 Cost Summary`,
    `  Today: $${summary.today.toFixed(4)}`,
    `  7 days: $${summary.last7Days.toFixed(4)}`,
    `  30 days: $${summary.last30Days.toFixed(4)}`,
  ];

  if (summary.perTab.length > 0) {
    lines.push('', '  Per tab:');
    for (const tab of summary.perTab.slice(0, 10)) {
      if (tab.cost > 0) {
        lines.push(`    ${tab.name}: $${tab.cost.toFixed(4)} (${tab.messages} msgs)`);
      }
    }
  }

  return lines.join('\n');
}

export function formatActivitySummary(summary: ActivitySummary): string {
  return [
    `📊 Activity (${summary.period})`,
    `  Messages in: ${summary.messagesReceived}`,
    `  Messages out: ${summary.messagesFromAssistant}`,
    `  Cron jobs fired: ${summary.cronJobsFired}`,
    `  Memories created: ${summary.memoriesCreated}`,
    `  Active tabs: ${summary.activeTabsCount}`,
    `  Cost: $${summary.totalCost.toFixed(4)}`,
  ].join('\n');
}

