import { logger } from '../util/logger.js';
import type { StreamUsage } from '../types.js';

export type ContextAction = 'ok' | 'warn' | 'checkpoint';

const DEFAULT_CONTEXT_WINDOW = 200_000; // Claude's context window in tokens
const WARNING_THRESHOLD = 0.80;
const CHECKPOINT_THRESHOLD = 0.90;

export class ContextMonitor {
  private cumulativeTokens = 0;
  private contextWindow: number;
  private warned = false;
  private checkpointed = false;

  constructor(
    private tabName: string,
    contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  ) {
    this.contextWindow = contextWindow;
  }

  /** Record token usage from a StreamAssistant or StreamResult event. Returns action needed. */
  recordUsage(usage: StreamUsage): ContextAction {
    this.cumulativeTokens += usage.input_tokens + usage.output_tokens +
      usage.cache_creation_input_tokens + usage.cache_read_input_tokens;

    const ratio = this.cumulativeTokens / this.contextWindow;

    if (ratio >= CHECKPOINT_THRESHOLD && !this.checkpointed) {
      this.checkpointed = true;
      logger.warn(`[${this.tabName}] Context at ${Math.round(ratio * 100)}% — checkpoint needed`);
      return 'checkpoint';
    }

    if (ratio >= WARNING_THRESHOLD && !this.warned) {
      this.warned = true;
      logger.info(`[${this.tabName}] Context at ${Math.round(ratio * 100)}% — warning`);
      return 'warn';
    }

    return 'ok';
  }

  get tokenCount(): number {
    return this.cumulativeTokens;
  }

  get usageRatio(): number {
    return this.cumulativeTokens / this.contextWindow;
  }

  reset(): void {
    this.cumulativeTokens = 0;
    this.warned = false;
    this.checkpointed = false;
  }
}
