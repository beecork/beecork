import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { getConfig } from '../config.js';
import { getDbPath, getPidPath, getBeecorkHome } from '../util/paths.js';

interface Check {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export async function runDoctor(): Promise<void> {
  const checks: Check[] = [];

  // 1. Check Claude binary
  try {
    const config = getConfig();
    const bin = config.claudeCode?.bin || 'claude';
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${whichCmd} ${bin}`, { encoding: 'utf-8' });
    try {
      const version = execSync(`${bin} --version 2>&1`, { encoding: 'utf-8' }).trim();
      checks.push({ name: 'Claude Code', status: 'pass', message: `Found: ${version}` });
    } catch {
      checks.push({ name: 'Claude Code', status: 'pass', message: `Found at: ${bin}` });
    }
  } catch {
    checks.push({ name: 'Claude Code', status: 'fail', message: 'Claude Code binary not found. Install: npm install -g @anthropic-ai/claude-code' });
  }

  // 2. Check config file
  const configPath = `${getBeecorkHome()}/config.json`;
  if (fs.existsSync(configPath)) {
    try {
      const config = getConfig();
      checks.push({ name: 'Config', status: 'pass', message: configPath });

      // 3. Check Telegram token
      if (config.telegram?.token) {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${config.telegram.token}/getMe`, { signal: AbortSignal.timeout(10000) });
          if (resp.ok) {
            const data = await resp.json() as { result: { username: string } };
            checks.push({ name: 'Telegram bot', status: 'pass', message: `@${data.result.username}` });
          } else {
            checks.push({ name: 'Telegram bot', status: 'fail', message: 'Invalid token — getMe returned error' });
          }
        } catch (err) {
          checks.push({ name: 'Telegram bot', status: 'warn', message: 'Could not reach Telegram API' });
        }
      } else {
        checks.push({ name: 'Telegram bot', status: 'warn', message: 'No token configured' });
      }

      // 4. Check WhatsApp session
      if (config.whatsapp?.enabled) {
        const sessionPath = config.whatsapp.sessionPath || `${getBeecorkHome()}/whatsapp-session`;
        if (fs.existsSync(sessionPath) && fs.readdirSync(sessionPath).length > 0) {
          checks.push({ name: 'WhatsApp session', status: 'pass', message: sessionPath });
        } else {
          checks.push({ name: 'WhatsApp session', status: 'warn', message: 'No session data — QR scan needed' });
        }
      }
    } catch (err) {
      checks.push({ name: 'Config', status: 'fail', message: `Invalid config: ${err}` });
    }
  } else {
    checks.push({ name: 'Config', status: 'fail', message: `Not found at ${configPath}. Run: beecork setup` });
  }

  // 5. Check database
  const dbPath = getDbPath();
  if (fs.existsSync(dbPath)) {
    try {
      const Database = (await import('better-sqlite3')).default;
      const db = new Database(dbPath, { readonly: true });
      const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (integrity[0]?.integrity_check === 'ok') {
        const size = (fs.statSync(dbPath).size / 1024).toFixed(0);
        checks.push({ name: 'Database', status: 'pass', message: `${size} KB, integrity OK` });
      } else {
        checks.push({ name: 'Database', status: 'fail', message: 'Integrity check failed!' });
      }
      db.close();
    } catch (err) {
      checks.push({ name: 'Database', status: 'fail', message: `Cannot open: ${err}` });
    }
  } else {
    checks.push({ name: 'Database', status: 'warn', message: 'No database yet — starts on first run' });
  }

  // 6. Check daemon
  const pidPath = getPidPath();
  if (fs.existsSync(pidPath)) {
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    try {
      process.kill(pid, 0);
      checks.push({ name: 'Daemon', status: 'pass', message: `Running (PID ${pid})` });
    } catch {
      checks.push({ name: 'Daemon', status: 'warn', message: `Stale PID file (PID ${pid} not running)` });
    }
  } else {
    checks.push({ name: 'Daemon', status: 'warn', message: 'Not running' });
  }

  // 7. Check disk space for media
  try {
    const mediaDir = `${getBeecorkHome()}/media`;
    const homeDir = getBeecorkHome();
    // Simple check: can we write a temp file?
    const testPath = `${homeDir}/.doctor-test`;
    fs.writeFileSync(testPath, 'test');
    fs.unlinkSync(testPath);

    if (fs.existsSync(mediaDir)) {
      const files = fs.readdirSync(mediaDir);
      checks.push({ name: 'Media dir', status: 'pass', message: `${files.length} files in ${mediaDir}` });
    } else {
      checks.push({ name: 'Media dir', status: 'pass', message: 'Not created yet (created on first media)' });
    }
  } catch {
    checks.push({ name: 'Disk space', status: 'fail', message: 'Cannot write to beecork home directory' });
  }

  // 8. Check MCP config
  const mcpConfigPath = `${getBeecorkHome()}/mcp-config.json`;
  if (fs.existsSync(mcpConfigPath)) {
    try {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
      const serverCount = Object.keys(mcpConfig.mcpServers || {}).length;
      checks.push({ name: 'MCP config', status: 'pass', message: `${serverCount} server(s) configured` });
    } catch {
      checks.push({ name: 'MCP config', status: 'fail', message: 'Invalid JSON in mcp-config.json' });
    }
  } else {
    checks.push({ name: 'MCP config', status: 'pass', message: 'Default (beecork MCP only)' });
  }

  // Print results
  console.log('\nBeecork Doctor\n');
  const icons = { pass: '\x1b[32m✓\x1b[0m', warn: '\x1b[33m!\x1b[0m', fail: '\x1b[31m✗\x1b[0m' };
  for (const check of checks) {
    console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
  }

  const fails = checks.filter(c => c.status === 'fail').length;
  const warns = checks.filter(c => c.status === 'warn').length;
  console.log(`\n  ${checks.length} checks: ${checks.length - fails - warns} passed, ${warns} warnings, ${fails} failures\n`);

  if (fails > 0) process.exit(1);
}
