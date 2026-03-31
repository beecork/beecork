import { spawn } from 'node:child_process';
import { getDb } from '../db/index.js';
import { getConfig } from '../config.js';

interface TabInfo {
  name: string;
  sessionId: string;
  workingDir: string;
  status: string;
  lastActivity: string;
  recentMessages: Array<{ role: string; content: string }>;
}

export function exportTab(tabName: string): TabInfo | null {
  const db = getDb();
  const tab = db.prepare('SELECT * FROM tabs WHERE name = ?').get(tabName) as any;
  if (!tab) return null;

  const messages = db.prepare(
    'SELECT role, content FROM messages WHERE tab_id = ? ORDER BY created_at DESC LIMIT 5'
  ).all(tab.id) as Array<{ role: string; content: string }>;

  return {
    name: tab.name,
    sessionId: tab.session_id,
    workingDir: tab.working_dir,
    status: tab.status,
    lastActivity: tab.last_activity_at,
    recentMessages: messages.reverse(),
  };
}

export function attachTab(tabName: string): void {
  const info = exportTab(tabName);
  if (!info) {
    console.error(`Tab "${tabName}" not found.`);
    process.exit(1);
  }

  const config = getConfig();
  const bin = config.claudeCode?.bin || 'claude';

  console.log(`\nAttaching to tab "${info.name}"...`);
  console.log(`  Session: ${info.sessionId}`);
  console.log(`  Working dir: ${info.workingDir}`);
  console.log(`  Status: ${info.status}`);
  console.log('');

  // Spawn Claude Code in the terminal, resuming the session
  const child = spawn(bin, [
    '--session-id', info.sessionId,
    '--resume',
  ], {
    cwd: info.workingDir,
    stdio: 'inherit', // Attach to terminal
    env: { ...process.env },
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

export function formatHandoffInfo(info: TabInfo): string {
  const lines = [
    `Session Handoff — tab "${info.name}"`,
    '',
    `Session ID: ${info.sessionId}`,
    `Working dir: ${info.workingDir}`,
    `Status: ${info.status}`,
    `Last activity: ${info.lastActivity}`,
    '',
    'To resume in terminal:',
    `  beecork attach ${info.name}`,
    '',
    'Or manually:',
    `  cd ${info.workingDir}`,
    `  claude --session-id ${info.sessionId} --resume`,
  ];

  if (info.recentMessages.length > 0) {
    lines.push('', 'Recent context:');
    for (const msg of info.recentMessages) {
      lines.push(`  [${msg.role}] ${msg.content.slice(0, 150)}${msg.content.length > 150 ? '...' : ''}`);
    }
  }

  return lines.join('\n');
}
