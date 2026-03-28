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
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      prompt,
    ];

    const proc = spawn(config.claudeCode.bin, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';

    proc.stdout!.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
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
      try {
        // Try to parse the JSON array from the output
        const jsonMatch = output.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          const facts = JSON.parse(jsonMatch[0]) as string[];
          if (Array.isArray(facts) && facts.every(f => typeof f === 'string')) {
            resolve(facts.slice(0, 5)); // Max 5 facts
            return;
          }
        }
        resolve([]);
      } catch {
        resolve([]);
      }
    });

    proc.on('error', reject);

    // Timeout after 30s
    setTimeout(() => {
      proc.kill('SIGTERM');
      resolve([]);
    }, 30000);
  });
}
