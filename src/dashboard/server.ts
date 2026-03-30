import http from 'node:http';
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import Database from 'better-sqlite3';
import { getDbPath } from '../util/paths.js';
import { getDashboardHtml } from './html.js';
import { VERSION } from '../version.js';
import { getDaemonPid } from '../cli/helpers.js';

function getDb(): Database.Database {
  const db = new Database(getDbPath(), { readonly: true });
  db.pragma('journal_mode = WAL');
  return db;
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : 'xdg-open';
  exec(`${cmd} ${url}`);
}

export function startDashboardServer(port = 0): void {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const path = url.pathname;

    // Serve HTML
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHtml());
      return;
    }

    // API routes
    let db: Database.Database | null = null;
    try {
      db = getDb();

      if (path === '/api/status') {
        const pid = getDaemonPid();
        const tabCount = (db.prepare('SELECT COUNT(*) as c FROM tabs').get() as { c: number }).c;
        const activeCount = (db.prepare("SELECT COUNT(*) as c FROM tabs WHERE status = 'running'").get() as { c: number }).c;
        const cronCount = (db.prepare("SELECT COUNT(*) as c FROM cron_jobs WHERE enabled = 1").get() as { c: number }).c;
        const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
        json(res, { version: VERSION, daemonPid: pid, tabs: tabCount, activeTabs: activeCount, cronJobs: cronCount, memories: memoryCount });
        return;
      }

      if (path === '/api/tabs') {
        const tabs = db.prepare(`
          SELECT t.*,
            (SELECT COUNT(*) FROM messages WHERE tab_id = t.id) as message_count,
            (SELECT COALESCE(SUM(cost_usd), 0) FROM messages WHERE tab_id = t.id) as total_cost
          FROM tabs t ORDER BY t.last_activity_at DESC
        `).all();
        json(res, tabs);
        return;
      }

      const tabMsgMatch = path.match(/^\/api\/tabs\/([^/]+)\/messages$/);
      if (tabMsgMatch) {
        const tabName = decodeURIComponent(tabMsgMatch[1]);
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const tab = db.prepare('SELECT id FROM tabs WHERE name = ?').get(tabName) as { id: string } | undefined;
        if (!tab) {
          json(res, { error: 'Tab not found' }, 404);
          return;
        }
        const messages = db.prepare(
          'SELECT role, content, cost_usd, tokens_in, tokens_out, created_at FROM messages WHERE tab_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
        ).all(tab.id, limit, offset);
        const total = (db.prepare('SELECT COUNT(*) as c FROM messages WHERE tab_id = ?').get(tab.id) as { c: number }).c;
        json(res, { messages: (messages as Array<Record<string, unknown>>).reverse(), total, limit, offset });
        return;
      }

      if (path === '/api/memories') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const q = url.searchParams.get('q') || '';
        let memories, total: number;
        if (q) {
          memories = db.prepare(
            'SELECT id, content, tab_name, source, created_at FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).all(`%${q}%`, limit, offset);
          total = (db.prepare('SELECT COUNT(*) as c FROM memories WHERE content LIKE ?').get(`%${q}%`) as { c: number }).c;
        } else {
          memories = db.prepare(
            'SELECT id, content, tab_name, source, created_at FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?'
          ).all(limit, offset);
          total = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
        }
        json(res, { memories, total, limit, offset });
        return;
      }

      if (path === '/api/crons') {
        const crons = db.prepare('SELECT * FROM cron_jobs ORDER BY created_at').all();
        json(res, crons);
        return;
      }

      if (path === '/api/costs') {
        const costs = db.prepare(`
          SELECT date(created_at) as day,
                 SUM(cost_usd) as total_cost,
                 COUNT(*) as message_count
          FROM messages
          WHERE role = 'assistant' AND cost_usd > 0
            AND created_at > datetime('now', '-30 days')
          GROUP BY date(created_at)
          ORDER BY day
        `).all();
        json(res, costs);
        return;
      }

      // 404
      json(res, { error: 'Not found' }, 404);
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    } finally {
      db?.close();
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      const url = `http://localhost:${addr.port}`;
      console.log(`\nBeecork Dashboard: ${url}\n`);
      console.log('Press Ctrl+C to stop.\n');
      openBrowser(url);
    }
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}
