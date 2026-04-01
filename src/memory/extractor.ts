import { spawn } from 'node:child_process';
import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';
import type { BeecorkConfig } from '../types.js';

const EXTRACTION_PROMPT = `Extract 0-5 key facts, decisions, or outcomes from this session transcript that would be useful in future sessions. Output ONLY a JSON array of strings. If nothing is worth remembering, output an empty array [].

Examples of what to extract:
- Server addresses, credentials, file paths
- User preferences ("prefers deployments after 11pm")
- Decisions made ("chose PostgreSQL over MySQL for X reason")
- Outcomes ("deploy succeeded", "bug was in auth middleware")

Session transcript:
`;

/** Auto-extract memories from a completed session */
export async function extractMemories(
  config: BeecorkConfig,
  tabName: string,
  sessionText: string,
  durationMs: number,
): Promise<void> {
  // Only extract from non-trivial sessions
  if (durationMs < 10000 || sessionText.length < 200) return;

  // Rate limit: check if we extracted recently for this tab
  const db = getDb();
  const recent = db.prepare(
    `SELECT COUNT(*) as count FROM memories
     WHERE tab_name = ? AND source = 'auto'
     AND created_at > datetime('now', '-5 minutes')`
  ).get(tabName) as { count: number };

  if (recent.count > 0) {
    logger.debug(`[${tabName}] Skipping memory extraction — too recent`);
    return;
  }

  try {
    const prompt = EXTRACTION_PROMPT + sessionText.slice(0, 5000); // Limit transcript size
    const facts = await runExtractionSession(config, prompt);

    if (facts.length === 0) return;

    for (const fact of facts) {
      db.prepare('INSERT INTO memories (content, tab_name, source) VALUES (?, ?, ?)').run(fact, tabName, 'auto');
    }

    // Enforce maxLongTermEntries limit
    const maxEntries = config.memory.maxLongTermEntries ?? 1000;
    const count = (db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    if (count > maxEntries) {
      const excess = count - maxEntries;
      db.prepare('DELETE FROM memories WHERE rowid IN (SELECT rowid FROM memories ORDER BY created_at ASC LIMIT ?)').run(excess);
      logger.info(`[${tabName}] Evicted ${excess} oldest memories (limit: ${maxEntries})`);
    }

    logger.info(`[${tabName}] Auto-extracted ${facts.length} memories`);
  } catch (err) {
    logger.error(`[${tabName}] Memory extraction failed:`, err);
  }
}

/** Inject relevant memories into a prompt */
export function getRelevantMemories(tabName: string): string[] {
  const db = getDb();

  // Get recent global memories + tab-specific memories
  const memories = db.prepare(
    `SELECT content FROM memories
     WHERE tab_name IS NULL OR tab_name = ?
     ORDER BY created_at DESC LIMIT 20`
  ).all(tabName) as Array<{ content: string }>;

  return memories.map(m => m.content);
}

async function runExtractionSession(config: BeecorkConfig, prompt: string): Promise<string[]> {
  // Prefer direct API call (cheaper, faster) when API key is available
  if (config.pipe?.anthropicApiKey) {
    return runExtractionViaApi(config.pipe.anthropicApiKey, config.pipe.routingModel, prompt);
  }
  // Fallback: spawn Claude Code subprocess
  return runExtractionViaSubprocess(config, prompt);
}

function parseFactsFromText(text: string): string[] {
  const jsonMatch = text.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    const facts = JSON.parse(jsonMatch[0]) as string[];
    if (Array.isArray(facts) && facts.every(f => typeof f === 'string')) {
      return facts.slice(0, 5);
    }
  }
  return [];
}

let cachedClient: any = null;
let cachedApiKey = '';

async function runExtractionViaApi(apiKey: string, model: string, prompt: string): Promise<string[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  if (!cachedClient || cachedApiKey !== apiKey) {
    cachedClient = new Anthropic({ apiKey });
    cachedApiKey = apiKey;
  }
  const client = cachedClient;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 500,
      system: 'Extract 0-5 key facts from this session transcript worth remembering across sessions. Output ONLY a JSON array of strings. If nothing is worth remembering, output [].',
      messages: [{ role: 'user', content: prompt }],
    }, { timeout: 15000 });

    const text = response.content.find((b: any) => b.type === 'text')?.text ?? '[]';
    return parseFactsFromText(text);
  } catch (err) {
    logger.warn('API-based memory extraction failed, falling back to subprocess:', err);
    return [];
  }
}

async function runExtractionViaSubprocess(config: BeecorkConfig, prompt: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const safeResolve = (val: string[]) => { if (!resolved) { resolved = true; resolve(val); } };
    const safeReject = (err: Error) => { if (!resolved) { resolved = true; reject(err); } };

    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      ...config.claudeCode.defaultFlags,
      '--no-session-persistence',
      prompt,
    ];

    const proc = spawn(config.claudeCode.bin, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let stdoutBuffer = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'result' && event.result) {
            output = event.result;
          }
        } catch { /* skip non-JSON */ }
      }
    });

    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        safeResolve(parseFactsFromText(output));
      } catch {
        safeResolve([]);
      }
    });

    proc.on('error', safeReject);

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      safeResolve([]);
    }, 30000);
  });
}
