import http from 'node:http';
import crypto from 'node:crypto';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import Database from 'better-sqlite3';
import { getDbPath } from '../util/paths.js';
import { getDashboardHtml } from './html.js';
import { VERSION } from '../version.js';
import { getDaemonPid } from '../cli/helpers.js';
import { validateTabName } from '../config.js';
import { createTabRecord } from '../db/index.js';

let cachedDashDb: Database.Database | null = null;
function getDashDb(): Database.Database {
  if (!cachedDashDb) {
    cachedDashDb = new Database(getDbPath(), { readonly: true });
    cachedDashDb.pragma('journal_mode = WAL');
  }
  return cachedDashDb;
}

let cachedWriteDb: Database.Database | null = null;
function getWriteDb(): Database.Database {
  if (!cachedWriteDb) {
    cachedWriteDb = new Database(getDbPath());
    cachedWriteDb.pragma('journal_mode = WAL');
  }
  return cachedWriteDb;
}

function withWriteDb<T>(fn: (db: Database.Database) => T): T {
  return fn(getWriteDb());
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function openBrowser(url: string): void {
  const cmd = platform() === 'darwin' ? 'open' : 'xdg-open';
  execFile(cmd, [url]);
}

export function startDashboardServer(port = 0): void {
  // Generate auth token at server start
  const authToken = crypto.randomBytes(24).toString('base64url');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const path = url.pathname;

    // Serve HTML
    if (path === '/' || path === '/index.html') {
      const token = url.searchParams.get('token');
      if (!token) {
        // Redirect to add token
        res.writeHead(302, { Location: `/?token=${authToken}` });
        res.end();
        return;
      }
      if (token !== authToken) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `beecork_dash=${authToken}; HttpOnly; SameSite=Strict; Path=/`,
      });
      res.end(getDashboardHtml(authToken));
      return;
    }

    // Auth check for API routes
    if (path.startsWith('/api/')) {
      const authHeader = req.headers.authorization;
      const queryToken = url.searchParams.get('token');
      const cookieToken = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('beecork_dash='))?.split('=')[1];
      const providedToken = authHeader?.replace('Bearer ', '') || queryToken || cookieToken;
      if (providedToken !== authToken) {
        json(res, { error: 'Unauthorized' }, 401);
        return;
      }
    }

    // API routes
    try {
      // SSE endpoint for real-time updates
      if (path === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        const interval = setInterval(() => {
          try {
            const db = getDashDb();
            const tabs = db.prepare('SELECT name, status, last_activity_at FROM tabs ORDER BY last_activity_at DESC').all();
            const activeCount = tabs.filter((t: any) => t.status === 'running').length;
            res.write(`data: ${JSON.stringify({ type: 'update', tabs, activeTabs: activeCount })}\n\n`);
          } catch {}
        }, 2000);

        req.on('close', () => {
          clearInterval(interval);
        });
        return;
      }

      // POST: Send message to tab
      if (path.match(/^\/api\/tabs\/[^/]+\/send$/) && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsed: any;
        try { parsed = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { message } = parsed;
        if (!message) { json(res, { error: 'Missing message' }, 400); return; }

        const tabName = decodeURIComponent(path.split('/')[3]);
        const tabErr = validateTabName(tabName);
        if (tabErr) { json(res, { error: tabErr }, 400); return; }
        withWriteDb(db => db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(tabName, message, 'user'));
        json(res, { success: true, tab: tabName });
        return;
      }

      // POST: Create tab
      if (path === '/api/tabs' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsedTab: any;
        try { parsedTab = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { name, workingDir, systemPrompt } = parsedTab;
        if (!name) { json(res, { error: 'Missing tab name' }, 400); return; }
        const nameErr = validateTabName(name);
        if (nameErr) { json(res, { error: nameErr }, 400); return; }

        withWriteDb(db => createTabRecord(db, { name, workingDir, systemPrompt }));
        json(res, { success: true, name });
        return;
      }

      // DELETE: Delete tab
      if (path.match(/^\/api\/tabs\/[^/]+$/) && req.method === 'DELETE') {
        const tabName = decodeURIComponent(path.split('/')[3]);
        withWriteDb(db => {
          const tab = db.prepare('SELECT id FROM tabs WHERE name = ?').get(tabName) as { id: string } | undefined;
          if (tab) {
            db.prepare('DELETE FROM messages WHERE tab_id = ?').run(tab.id);
            db.prepare('DELETE FROM tabs WHERE id = ?').run(tab.id);
          }
        });
        json(res, { success: true });
        return;
      }

      // POST: Create task (supports both /api/tasks and /api/crons)
      if ((path === '/api/tasks' || path === '/api/crons') && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsedCron: any;
        try { parsedCron = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { name, scheduleType, schedule, tabName, message } = parsedCron;
        if (!name || !schedule || !message) { json(res, { error: 'Missing required fields' }, 400); return; }
        const effectiveTab = tabName || 'default';
        const cronTabErr = validateTabName(effectiveTab);
        if (cronTabErr) { json(res, { error: cronTabErr }, 400); return; }

        const id = crypto.randomUUID();
        withWriteDb(db => db.prepare('INSERT INTO tasks (id, name, schedule_type, schedule, tab_name, message, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)').run(
          id, name, scheduleType || 'every', schedule, effectiveTab, message
        ));
        json(res, { success: true, id });
        return;
      }

      // DELETE: Delete task (supports both /api/tasks and /api/crons)
      if ((path.match(/^\/api\/tasks\/[^/]+$/) || path.match(/^\/api\/crons\/[^/]+$/)) && req.method === 'DELETE') {
        const taskId = decodeURIComponent(path.split('/')[3]);
        withWriteDb(db => db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId));
        json(res, { success: true });
        return;
      }

      // GET: List watchers
      if (path === '/api/watchers' && req.method === 'GET') {
        const watchers = getDashDb().prepare('SELECT * FROM watchers ORDER BY created_at').all();
        json(res, watchers);
        return;
      }

      // DELETE: Delete watcher
      if (path.match(/^\/api\/watchers\/[^/]+$/) && req.method === 'DELETE') {
        const watcherId = decodeURIComponent(path.split('/')[3]);
        withWriteDb(db => db.prepare('DELETE FROM watchers WHERE id = ?').run(watcherId));
        json(res, { success: true });
        return;
      }

      // POST: Create memory
      if (path === '/api/memories' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsedMemory: any;
        try { parsedMemory = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { content, tabName } = parsedMemory;
        if (!content) { json(res, { error: 'Missing content' }, 400); return; }

        withWriteDb(db => db.prepare('INSERT INTO memories (content, tab_name, source) VALUES (?, ?, ?)').run(content, tabName || null, 'tool'));
        json(res, { success: true });
        return;
      }

      // DELETE: Delete memory
      if (path.match(/^\/api\/memories\/\d+$/) && req.method === 'DELETE') {
        const memoryId = path.split('/')[3];
        withWriteDb(db => db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId));
        json(res, { success: true });
        return;
      }

      if (path === '/api/media/config') {
        const { getConfig } = await import('../config.js');
        const config = getConfig();
        const generators = config.mediaGenerators || [];
        const info = generators.map((g: any) => ({
          provider: g.provider,
          model: g.model,
          configured: !!g.apiKey,
        }));
        json(res, { generators: info });
        return;
      }

      if (path === '/api/channels/config') {
        const { getConfig } = await import('../config.js');
        const config = getConfig();
        const channels = {
          telegram: { configured: !!config.telegram?.token, botUsername: null as string | null },
          discord: { configured: !!config.discord?.token },
          whatsapp: { configured: !!config.whatsapp?.enabled },
          webhook: { configured: !!config.webhook?.enabled, port: config.webhook?.port },
        };
        json(res, channels);
        return;
      }

      if (path === '/api/computer-use' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsedCU: any;
        try { parsedCU = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { enabled } = parsedCU;
        const { getConfig, saveConfig } = await import('../config.js');
        const config = getConfig();
        config.claudeCode.computerUse = !!enabled;
        saveConfig(config);
        json(res, { enabled: !!enabled, message: 'Restart daemon to apply.' });
        return;
      }

      if (path === '/api/computer-use') {
        const { getConfig } = await import('../config.js');
        const config = getConfig();
        json(res, { enabled: !!config.claudeCode.computerUse });
        return;
      }

      if (path === '/api/timeline') {
        const { getTimeline } = await import('../timeline/index.js');
        const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const events = getTimeline({ date, limit });
        json(res, { events });
        return;
      }

      const db = getDashDb();

      if (path === '/api/status') {
        const pid = getDaemonPid();
        const tabCount = (db.prepare('SELECT COUNT(*) as c FROM tabs').get() as { c: number }).c;
        const activeCount = (db.prepare("SELECT COUNT(*) as c FROM tabs WHERE status = 'running'").get() as { c: number }).c;
        const cronCount = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE enabled = 1").get() as { c: number }).c;
        const memoryCount = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
        json(res, { version: VERSION, daemonPid: pid, tabs: tabCount, activeTabs: activeCount, cronJobs: cronCount, memories: memoryCount });
        return;
      }

      if (path === '/api/tabs' && req.method === 'GET') {
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

      if (path === '/api/memories' && req.method === 'GET') {
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

      if ((path === '/api/tasks' || path === '/api/crons') && req.method === 'GET') {
        const crons = db.prepare('SELECT * FROM tasks ORDER BY created_at').all();
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

      // GET /api/update/status — check versions for beecork, claude code, and other packages
      if (path === '/api/update/status') {
        const execAsync = promisify(exec);

        async function checkPackage(name: string, installCmd?: string): Promise<Record<string, unknown>> {
          const pkg: Record<string, unknown> = { name };
          try {
            const { stdout } = await execAsync(`${installCmd || name} --version`, { timeout: 10000 });
            pkg.installed = stdout.trim().replace(/^v/, '');
          } catch { pkg.installed = null; }
          try {
            const { stdout } = await execAsync(`npm view ${name} version`, { timeout: 10000 });
            pkg.latest = stdout.trim();
          } catch { pkg.latest = null; }
          pkg.updateAvailable = !!(pkg.installed && pkg.latest && pkg.installed !== pkg.latest);
          return pkg;
        }

        const packages = await Promise.all([
          (async () => {
            const p = await checkPackage('beecork');
            p.installed = VERSION; // use our known version, more reliable
            p.updateAvailable = !!(p.latest && p.installed !== p.latest);
            return p;
          })(),
          (async () => {
            const p: Record<string, unknown> = { name: '@anthropic-ai/claude-code' };
            try {
              const { stdout } = await execAsync('claude --version', { timeout: 10000 });
              p.installed = stdout.trim().replace(/^.*?(\d+\.\d+\.\d+).*$/, '$1');
            } catch { p.installed = null; }
            try {
              const { stdout } = await execAsync('npm view @anthropic-ai/claude-code version', { timeout: 10000 });
              p.latest = stdout.trim();
            } catch { p.latest = null; }
            p.updateAvailable = !!(p.installed && p.latest && p.installed !== p.latest);
            return p;
          })(),
        ]);

        json(res, { packages });
        return;
      }

      // POST /api/update/:package — update a specific package
      if (path.match(/^\/api\/update\/[^/]+$/) && req.method === 'POST') {
        const pkgName = decodeURIComponent(path.split('/')[3]);
        const execAsync = promisify(exec);

        const allowedPackages: Record<string, string> = {
          'beecork': 'npm install -g beecork@latest',
          '@anthropic-ai/claude-code': 'npm install -g @anthropic-ai/claude-code@latest',
        };

        const cmd = allowedPackages[pkgName];
        if (!cmd) {
          json(res, { error: `Package "${pkgName}" is not in the allowed update list.` }, 400);
          return;
        }

        try {
          const { stdout } = await execAsync(cmd, { timeout: 120000 });
          json(res, { success: true, package: pkgName, output: stdout.trim() });
        } catch (err: any) {
          json(res, { error: err.message }, 500);
        }
        return;
      }

      // GET /api/capabilities — list all packs + enabled status
      if (path === '/api/capabilities') {
        const { getAvailablePacks, isEnabled } = await import('../capabilities/index.js');
        const packs = getAvailablePacks().map(p => ({
          ...p,
          enabled: isEnabled(p.id),
          // Don't expose API keys in the response
          mcpServer: { package: p.mcpServer.package },
        }));
        json(res, { packs });
        return;
      }

      // POST /api/capabilities/:id/enable — enable a pack
      if (path.match(/^\/api\/capabilities\/[^/]+\/enable$/) && req.method === 'POST') {
        const packId = path.split('/')[3];
        let body = '';
        for await (const chunk of req) { body += chunk; if (body.length > 1_000_000) { json(res, { error: 'Payload too large' }, 413); return; } }
        let parsedCap: any;
        try { parsedCap = JSON.parse(body); } catch { json(res, { error: 'Invalid JSON' }, 400); return; }
        const { apiKey } = parsedCap;
        const { enablePack } = await import('../capabilities/index.js');
        try {
          enablePack(packId, apiKey);
          json(res, { success: true, message: 'Restart daemon to activate.' });
        } catch (err: any) {
          json(res, { error: err.message }, 400);
        }
        return;
      }

      // POST /api/capabilities/:id/disable — disable a pack
      if (path.match(/^\/api\/capabilities\/[^/]+\/disable$/) && req.method === 'POST') {
        const packId = path.split('/')[3];
        const { disablePack } = await import('../capabilities/index.js');
        disablePack(packId);
        json(res, { success: true });
        return;
      }

      // 404
      json(res, { error: 'Not found' }, 404);
    } catch (err) {
      console.error('Dashboard error:', err);
      json(res, { error: 'Internal server error' }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    if (addr && typeof addr === 'object') {
      const url = `http://localhost:${addr.port}?token=${authToken}`;
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
