import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import { ClaudeSubprocess, type SubprocessCallbacks } from './subprocess.js';
import { CircuitBreaker, type CircuitBreakerAction } from './circuit-breaker.js';
import { ContextMonitor, type ContextAction } from './context-monitor.js';
import { getDb } from '../db/index.js';
import { resolveWorkingDir, validateTabName } from '../config.js';
import { logger } from '../util/logger.js';
import { extractMemories, getRelevantMemories } from '../memory/extractor.js';
import type {
  BeecorkConfig,
  Tab,
  TabStatus,
  StreamEvent,
  StreamInit,
  StreamAssistant,
  StreamResult,
  StreamContentToolUse,
} from '../types.js';

// SQLite returns snake_case columns, map to camelCase Tab interface
interface TabRow {
  id: string;
  name: string;
  session_id: string;
  status: TabStatus;
  working_dir: string;
  created_at: string;
  last_activity_at: string;
  pid: number | null;
  system_prompt: string | null;
}

function rowToTab(row: TabRow): Tab {
  return {
    id: row.id,
    name: row.name,
    sessionId: row.session_id,
    status: row.status,
    workingDir: row.working_dir,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    pid: row.pid,
    systemPrompt: row.system_prompt,
  };
}

export interface SendResult {
  text: string;
  costUsd: number;
  durationMs: number;
  sessionId: string;
  error: boolean;
}

const MAX_QUEUE_SIZE = 10;
let pendingPollCount = 0;

export type NotifyCallback = (text: string) => Promise<void>;

export class TabManager {
  private subprocesses: Map<string, ClaudeSubprocess> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private messageQueues: Map<string, Array<{ prompt: string; resolve: (r: SendResult) => void; reject: (e: Error) => void }>> = new Map();
  private onNotify: NotifyCallback | null = null;

  constructor(private config: BeecorkConfig) {}

  /** Set a callback for sending notifications (e.g., via Telegram) */
  setNotifyCallback(cb: NotifyCallback): void {
    this.onNotify = cb;
  }

  /** Ensure a tab exists in the database. Creates it if missing. */
  ensureTab(tabName: string, workingDirOverride?: string): Tab {
    const db = getDb();
    const existing = this.queryTab(db, tabName);
    if (existing) return existing;

    // Validate tab name before creating (centralized for all channels + MCP)
    if (tabName !== 'default') {
      const validationError = validateTabName(tabName);
      if (validationError) throw new Error(validationError);
    }

    // Check for a matching tab template
    const template = this.config.tabTemplates?.[tabName];

    const tab: Tab = {
      id: uuidv4(),
      name: tabName,
      sessionId: uuidv4(),
      status: 'idle',
      workingDir: workingDirOverride || template?.workingDir || resolveWorkingDir(tabName),
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      pid: null,
      systemPrompt: template?.systemPrompt || null,
    };

    db.prepare(`
      INSERT INTO tabs (id, name, session_id, status, working_dir, created_at, last_activity_at, system_prompt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tab.id, tab.name, tab.sessionId, tab.status, tab.workingDir, tab.createdAt, tab.lastActivityAt, tab.systemPrompt);

    logger.info(`Created tab: ${tabName}`);
    return tab;
  }

  /** Send a message to a tab. Creates the tab if it doesn't exist. Queues if busy. */
  async sendMessage(tabName: string, prompt: string, options?: { resume?: boolean; onTextChunk?: (text: string) => void; onToolUse?: (toolName: string, toolInput: Record<string, unknown>) => void; skipExtraction?: boolean; projectPath?: string }): Promise<SendResult> {
    const tab = this.ensureTab(tabName, options?.projectPath);

    // If a subprocess is already running on this tab, queue the message
    if (this.subprocesses.get(tabName)?.isRunning) {
      const queue = this.messageQueues.get(tabName) ?? [];
      if (queue.length >= MAX_QUEUE_SIZE) {
        return Promise.reject(new Error(`Queue full for tab "${tabName}" (max ${MAX_QUEUE_SIZE}). Try again later.`));
      }
      return new Promise((resolve, reject) => {
        if (!this.messageQueues.has(tabName)) {
          this.messageQueues.set(tabName, []);
        }
        this.messageQueues.get(tabName)!.push({ prompt, resolve, reject });
        logger.info(`[${tabName}] Message queued (queue size: ${this.messageQueues.get(tabName)!.length})`);
      });
    }

    return this.executeMessage(tab, prompt, options?.resume ?? false, options?.onTextChunk, options?.skipExtraction, options?.onToolUse);
  }

  /** Get all tabs from the database */
  listTabs(): Tab[] {
    const db = getDb();
    return (db.prepare('SELECT * FROM tabs ORDER BY last_activity_at DESC').all() as TabRow[]).map(rowToTab);
  }

  /** Get a specific tab */
  getTab(tabName: string): Tab | undefined {
    const db = getDb();
    return this.queryTab(db, tabName);
  }

  private queryTab(db: Database.Database, tabName: string): Tab | undefined {
    const row = db.prepare('SELECT * FROM tabs WHERE name = ?').get(tabName) as TabRow | undefined;
    return row ? rowToTab(row) : undefined;
  }

  /** Stop a tab's running subprocess */
  stopTab(tabName: string): void {
    const sub = this.subprocesses.get(tabName);
    if (sub?.isRunning) {
      sub.kill();
    }
    this.updateTabStatus(tabName, 'stopped');
    this.clearQueue(tabName);
  }

  /** Stop all running subprocesses (clean shutdown) */
  stopAll(): void {
    for (const [tabName, sub] of this.subprocesses) {
      if (sub.isRunning) {
        sub.kill();
      }
      this.updateTabStatus(tabName, 'stopped');
    }
    this.subprocesses.clear();
    this.circuitBreakers.clear();
    this.messageQueues.clear();
  }

  /** Process pending messages from MCP server IPC */
  processPendingMessages(): void {
    const db = getDb();

    // Periodic cleanup: delete old processed messages every ~100 polls (~8 minutes at 5s interval)
    pendingPollCount++;
    if (pendingPollCount % 100 === 0) {
      db.prepare("DELETE FROM pending_messages WHERE processed = 1 AND created_at < datetime('now', '-1 day')").run();
    }

    const pending = db.prepare(
      'SELECT * FROM pending_messages WHERE processed = 0 ORDER BY created_at ASC'
    ).all() as Array<{ id: number; tab_name: string; message: string; type?: string }>;

    if (pending.length === 0) return;

    for (const msg of pending) {
      db.prepare('UPDATE pending_messages SET processed = 1 WHERE id = ?').run(msg.id);

      if (msg.type === 'notification') {
        // Route notifications to Telegram/WhatsApp via the notify callback
        this.onNotify?.(msg.message).catch(err => logger.warn('Notify failed:', err));
      } else {
        // Route regular messages to tabs
        this.sendMessage(msg.tab_name, msg.message).catch(err => {
          logger.error(`Failed to process pending message for tab ${msg.tab_name}:`, err);
        });
      }
    }
  }

  private async executeMessage(tab: Tab, prompt: string, resume: boolean, onTextChunk?: (text: string) => void, skipExtraction?: boolean, onToolUse?: (toolName: string, toolInput: Record<string, unknown>) => void): Promise<SendResult> {
    const db = getDb();

    // Budget check before spawning
    if (this.config.claudeCode.maxBudgetUsd) {
      const tabSpend = (db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM messages WHERE tab_id = ?').get(tab.id) as { total: number }).total;
      if (tabSpend >= this.config.claudeCode.maxBudgetUsd) {
        const msg = `Budget limit reached for tab "${tab.name}": $${tabSpend.toFixed(2)} / $${this.config.claudeCode.maxBudgetUsd.toFixed(2)}`;
        this.onNotify?.(msg).catch(() => {});
        return { text: msg, costUsd: 0, durationMs: 0, sessionId: tab.sessionId, error: true };
      }
      // Warn at 80%
      if (tabSpend >= this.config.claudeCode.maxBudgetUsd * 0.8) {
        this.onNotify?.(`⚠️ Budget warning: tab "${tab.name}" at $${tabSpend.toFixed(2)} / $${this.config.claudeCode.maxBudgetUsd.toFixed(2)} (80%)`).catch(() => {});
      }
    }

    // Log approval mode (full interactive approval coming in a future release)
    const tabConfig = this.config.tabs[tab.name] || this.config.tabs['default'];
    if (tabConfig?.approvalMode && tabConfig.approvalMode !== 'yolo') {
      logger.warn(`Tab "${tab.name}" has approvalMode="${tabConfig.approvalMode}" — interactive approval not yet implemented, running in yolo mode`);
    }

    // Inject relevant memories into the prompt
    const memories = getRelevantMemories(tab.name);
    let enrichedPrompt = prompt;
    if (memories.length > 0) {
      const memoryContext = memories.map(m => `- ${m}`).join('\n');
      enrichedPrompt = `[Context from memory:\n${memoryContext}\n]\n\n${prompt}`;
    }

    // Store user message
    db.prepare('INSERT INTO messages (tab_id, role, content) VALUES (?, ?, ?)')
      .run(tab.id, 'user', prompt);

    this.updateTabStatus(tab.name, 'running');

    // Get fresh tab to pick up system_prompt
    const freshTab = this.queryTab(db, tab.name) || tab;

    const subprocess = new ClaudeSubprocess(
      tab.name,
      tab.workingDir,
      this.config,
      tab.sessionId,
      freshTab.systemPrompt,
    );
    this.subprocesses.set(tab.name, subprocess);

    const breaker = new CircuitBreaker(tab.name);
    this.circuitBreakers.set(tab.name, breaker);
    const contextMonitor = new ContextMonitor(tab.name);

    // Resume if: explicitly requested or DB has prior successful responses for this tab
    const hasDbHistory = db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE tab_id = ? AND role = ?'
    ).get(tab.id, 'assistant') as { count: number };
    const shouldResume = resume || hasDbHistory.count > 0;

    return new Promise<SendResult>((resolve, reject) => {
      let resultText = '';
      let resultEvent: StreamResult | null = null;
      let loopWarningPending = false;
      let checkpointTriggered = false;

      const callbacks: SubprocessCallbacks = {
        onEvent: (event: StreamEvent) => {
          // Capture session_id from StreamInit and update tab record
          if (event.type === 'system' && 'subtype' in event && event.subtype === 'init') {
            const initEvent = event as StreamInit;
            if (initEvent.session_id) {
              db.prepare('UPDATE tabs SET session_id = ? WHERE id = ?')
                .run(initEvent.session_id, tab.id);
            }
          }

          if (event.type === 'assistant') {
            const assistant = event as StreamAssistant;
            // Track context usage
            if (assistant.message.usage) {
              const contextAction: ContextAction = contextMonitor.recordUsage(assistant.message.usage);
              if (contextAction === 'warn') {
                // Will inject warning on next message
                logger.info(`[${tab.name}] Context window warning — will summarize on next turn`);
              } else if (contextAction === 'checkpoint') {
                checkpointTriggered = true;
                logger.warn(`[${tab.name}] Context window checkpoint triggered`);
              }
            }

            for (const block of assistant.message.content) {
              if (block.type === 'text') {
                resultText += block.text;
                onTextChunk?.(block.text);
              } else if (block.type === 'tool_use') {
                const toolUse = block as StreamContentToolUse;
                onToolUse?.(toolUse.name, toolUse.input);
                const action: CircuitBreakerAction = breaker.recordToolCall(toolUse);
                if (action === 'break') {
                  logger.warn(`[${tab.name}] Circuit breaker tripped, killing subprocess`);
                  subprocess.kill();
                } else if (action === 'notify') {
                  this.onNotify?.(`Loop detected in tab "${tab.name}": ${toolUse.name} repeated 10+ times. Send /stop ${tab.name} to kill it.`).catch(err => logger.warn('Notify failed:', err));
                } else if (action === 'warn') {
                  loopWarningPending = true;
                }
              }
            }
          } else if (event.type === 'result') {
            resultEvent = event as StreamResult;
          }
        },
        onExit: (code) => {
          this.subprocesses.delete(tab.name);
          this.circuitBreakers.delete(tab.name);

          const result: SendResult = {
            text: resultEvent?.result ?? resultText,
            costUsd: resultEvent?.total_cost_usd ?? 0,
            durationMs: resultEvent?.duration_ms ?? 0,
            sessionId: subprocess.sessionId,
            error: resultEvent?.is_error ?? (code !== 0),
          };

          // Handle resume failure (session expired/not found) — retry with fresh session + context
          if (result.error && shouldResume && result.text.includes('session')) {
            logger.info(`[${tab.name}] Session resume failed, retrying with context injection`);
            const recentMsgs = db.prepare(
              'SELECT role, content FROM messages WHERE tab_id = ? ORDER BY created_at DESC LIMIT 5'
            ).all(tab.id) as Array<{ role: string; content: string }>;
            const context = recentMsgs.reverse().map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n');
            const contextPrompt = `[Previous conversation context:\n${context}\n]\n\n${enrichedPrompt}`;

            // Reset session ID for fresh start
            const newSessionId = uuidv4();
            db.prepare('UPDATE tabs SET session_id = ?, status = ? WHERE id = ?').run(newSessionId, 'idle', tab.id);

            this.executeMessage({ ...tab, sessionId: newSessionId }, contextPrompt, false, onTextChunk)
              .then(resolve).catch(reject);
            return;
          }

          // Store assistant response
          db.prepare(
            'INSERT INTO messages (tab_id, role, content, cost_usd, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(
            tab.id,
            'assistant',
            result.text,
            result.costUsd,
            resultEvent?.usage?.input_tokens ?? null,
            resultEvent?.usage?.output_tokens ?? null,
          );

          // Update tab
          db.prepare('UPDATE tabs SET status = ?, last_activity_at = ?, pid = NULL WHERE name = ?')
            .run('idle', new Date().toISOString(), tab.name);

          // Context window compaction: if checkpoint was triggered, restart with summary
          if (checkpointTriggered && !result.error && result.text) {
            logger.info(`[${tab.name}] Compacting context — requesting summary then restarting session`);
            this.onNotify?.(`🔄 [${tab.name}] Context window full — compacting and continuing...`).catch(err => logger.warn('Notify failed:', err));

            // Ask Claude for a structured summary
            const summaryPrompt = 'Summarize your progress in this session concisely: completed steps, current state, remaining steps, and all important identifiers (file paths, URLs, variable names). Output ONLY the summary.';
            this.sendMessage(tab.name, summaryPrompt).then(summaryResult => {
              // Store summary as checkpoint memory
              db.prepare('INSERT INTO memories (content, tab_name, source) VALUES (?, ?, ?)')
                .run(`[checkpoint] ${summaryResult.text}`, tab.name, 'auto');

              // Reset session: new session ID so next message starts fresh with summary context
              const newSessionId = uuidv4();
              db.prepare('UPDATE tabs SET session_id = ? WHERE id = ?').run(newSessionId, tab.id);
              logger.info(`[${tab.name}] Context compacted — new session ${newSessionId.slice(0, 8)}...`);

              // Continue with original goal using the summary as context
              const continuationPrompt = `[CONTEXT RESTORED FROM PREVIOUS SESSION]\n${summaryResult.text}\n\n[Continue the original task: "${enrichedPrompt.slice(0, 500)}"]`;
              this.sendMessage(tab.name, continuationPrompt, { onTextChunk }).then(resolve).catch(reject);
            }).catch(err => {
              logger.error(`[${tab.name}] Compaction failed:`, err);
              resolve(result); // Fall back to returning the original result
            });
            return; // Don't resolve yet — compaction flow will resolve
          }

          // Check for delegation completion
          import('../delegation/manager.js').then(({ completeDelegation }) => {
            const delegation = completeDelegation(tab.name, result.text);
            if (delegation && delegation.returnToTab) {
              // Queue result message back to the source tab
              db.prepare('INSERT INTO pending_messages (tab_name, message, type) VALUES (?, ?, ?)').run(
                delegation.returnToTab,
                `[Result from tab:${tab.name}]: ${result.text.slice(0, 10000)}`,
                'delegation_result'
              );
              this.onNotify?.(`Delegation complete: ${tab.name} → result sent back to ${delegation.returnToTab}`).catch(() => {});
              logger.info(`Delegation result sent: ${tab.name} → ${delegation.returnToTab}`);
            }
          }).catch(err => {
            logger.warn('Delegation completion check failed:', err);
          });

          resolve(result);

          // Auto-extract memories from completed sessions (fire and forget)
          // Skip if pipe brain already handles extraction via PipeBrain.learn()
          if (!result.error && result.text && !skipExtraction) {
            extractMemories(this.config, tab.name, result.text, result.durationMs).catch(err => {
              logger.error(`[${tab.name}] Memory extraction error:`, err);
            });
          }

          // Process next queued message (prepend loop warning if needed)
          if (loopWarningPending && this.messageQueues.get(tab.name)?.length) {
            const next = this.messageQueues.get(tab.name)![0];
            next.prompt = `[WARNING: You appear to be repeating the same action. Reassess your approach.]\n\n${next.prompt}`;
            loopWarningPending = false;
          }
          this.processNextInQueue(tab.name);
        },
        onError: (err) => {
          this.subprocesses.delete(tab.name);
          this.circuitBreakers.delete(tab.name);
          this.updateTabStatus(tab.name, 'error');
          reject(err);
          this.processNextInQueue(tab.name);
        },
      };

      subprocess.send(enrichedPrompt, callbacks, shouldResume).catch(reject);

      // Update tab with PID
      if (subprocess.pid) {
        db.prepare('UPDATE tabs SET pid = ? WHERE name = ?').run(subprocess.pid, tab.name);
      }
    });
  }

  private processNextInQueue(tabName: string): void {
    const queue = this.messageQueues.get(tabName);
    if (!queue || queue.length === 0) return;

    const next = queue.shift()!;
    const tab = this.getTab(tabName);
    if (!tab) {
      next.reject(new Error(`Tab "${tabName}" not found`));
      return;
    }

    this.executeMessage(tab, next.prompt, false).then(next.resolve).catch(next.reject);
  }

  private updateTabStatus(tabName: string, status: TabStatus): void {
    const db = getDb();
    db.prepare('UPDATE tabs SET status = ?, last_activity_at = ? WHERE name = ?')
      .run(status, new Date().toISOString(), tabName);
  }

  private clearQueue(tabName: string): void {
    const queue = this.messageQueues.get(tabName);
    if (queue) {
      for (const item of queue) {
        item.reject(new Error(`Tab "${tabName}" was stopped`));
      }
      this.messageQueues.delete(tabName);
    }
  }
}
