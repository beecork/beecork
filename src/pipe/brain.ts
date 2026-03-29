import { PipeAnthropicClient } from './anthropic-client.js';
import { PipeMemoryStore } from './memory-store.js';
import { scanForProjects } from './project-scanner.js';
import { parseTabMessage } from '../util/text.js';
import { logger } from '../util/logger.js';
import type { TabManager, SendResult } from '../session/manager.js';
import type { BeecorkConfig } from '../types.js';
import type { ChatContext, PipeResult, RouteDecision, GoalEvaluation, KnowledgeEntry } from './types.js';

export class PipeBrain {
  private client: PipeAnthropicClient;
  private memory: PipeMemoryStore;
  private config: BeecorkConfig;
  private tabManager: TabManager;
  private notifyCallback: ((text: string) => Promise<void>) | null = null;

  constructor(config: BeecorkConfig, tabManager: TabManager) {
    this.config = config;
    this.tabManager = tabManager;
    this.client = new PipeAnthropicClient(config.pipe.anthropicApiKey);
    this.memory = new PipeMemoryStore();
  }

  setNotifyCallback(cb: (text: string) => Promise<void>): void {
    this.notifyCallback = cb;
  }

  /** Main entry point: process a user message with intelligence */
  async process(message: string, context: ChatContext): Promise<PipeResult> {
    const decisions: string[] = [];

    // Step 1: Route the message to the right tab/project
    const route = await this.route(message, decisions);

    // Step 2: Ensure the tab exists with the right working directory
    if (route.projectPath) {
      this.tabManager.ensureTab(route.tabName);
      this.memory.updateProjectLastUsed(route.projectPath);
    }

    // Step 3: Send to Claude Code
    let result: SendResult;
    try {
      result = await this.tabManager.sendMessage(route.tabName, message);
    } catch (err) {
      return {
        tabName: route.tabName,
        response: { text: `Error: ${err instanceof Error ? err.message : err}`, error: true, costUsd: 0, durationMs: 0 },
        decisions,
        goalStatus: null,
      };
    }

    // Step 4: Evaluate if the goal was achieved
    let goalStatus: GoalEvaluation | null = null;
    if (!result.error && result.text && result.durationMs > 3000) {
      goalStatus = await this.evaluateAndFollowUp(message, result, route.tabName, decisions);
    }

    // Step 5: Learn from the conversation (fire and forget)
    this.learn(route.tabName, message, result.text).catch(err => {
      logger.error('Pipe learning failed:', err);
    });

    return {
      tabName: route.tabName,
      response: { text: result.text, error: result.error, costUsd: result.costUsd, durationMs: result.durationMs },
      decisions,
      goalStatus,
    };
  }

  /** Route a message to the right project/tab */
  private async route(message: string, decisions: string[]): Promise<RouteDecision> {
    // Check for manual /tab override first
    if (message.startsWith('/tab ')) {
      const parsed = parseTabMessage(message);
      if (parsed.tabName !== 'default') {
        decisions.push(`📌 Manual routing to "${parsed.tabName}"`);
        return { tabName: parsed.tabName, projectPath: null, confidence: 1.0, reason: 'Manual override', needsConfirmation: false };
      }
    }

    const projects = this.memory.getProjects();
    const recentRouting = this.memory.getRecentRouting(5);

    // If no projects and no API key, just use default
    if (projects.length === 0 || !this.config.pipe.anthropicApiKey) {
      decisions.push('📍 Routing to default tab (no projects discovered)');
      return { tabName: 'default', projectPath: null, confidence: 1.0, reason: 'No projects', needsConfirmation: false };
    }

    try {
      const route = await this.client.route(message, projects, recentRouting);

      // Record the routing decision
      this.memory.recordRouting(message, route.tabName, route.projectPath, route.confidence);

      if (route.confidence >= this.config.pipe.confidenceThreshold) {
        decisions.push(`🧠 Routing to "${route.tabName}" (${Math.round(route.confidence * 100)}% confidence) — ${route.reason}`);
      } else {
        decisions.push(`🤔 Low confidence routing to "${route.tabName}" (${Math.round(route.confidence * 100)}%) — ${route.reason}. Using default.`);
        route.tabName = 'default';
      }

      return route;
    } catch (err) {
      logger.error('Pipe routing failed, using default:', err);
      decisions.push('⚠️ Routing failed, using default tab');
      return { tabName: 'default', projectPath: null, confidence: 0.5, reason: 'Routing error', needsConfirmation: false };
    }
  }

  /** Evaluate if the goal was achieved and send follow-ups if needed */
  private async evaluateAndFollowUp(
    originalGoal: string,
    lastResult: SendResult,
    tabName: string,
    decisions: string[],
  ): Promise<GoalEvaluation> {
    let currentResult = lastResult;
    let followUpCount = 0;
    const maxFollowUps = this.config.pipe.maxFollowUps;

    while (followUpCount < maxFollowUps) {
      try {
        const evaluation = await this.client.evaluateGoal(originalGoal, currentResult.text);

        if (evaluation.status === 'done') {
          decisions.push(`✅ Goal achieved: ${evaluation.reason}`);
          return evaluation;
        }

        if (evaluation.status === 'failed') {
          decisions.push(`❌ Goal failed: ${evaluation.reason}`);
          return evaluation;
        }

        // PARTIAL — send follow-up
        followUpCount++;
        const followUpMsg = evaluation.followUp || `Continue working on the original goal: "${originalGoal}". You haven't finished yet.`;
        decisions.push(`🔄 Follow-up ${followUpCount}/${maxFollowUps}: ${evaluation.reason}`);

        // Notify user about the follow-up
        await this.notifyCallback?.(`🔄 [${tabName}] Sending follow-up (${followUpCount}/${maxFollowUps}): ${evaluation.reason}`);

        // Send follow-up to Claude Code
        currentResult = await this.tabManager.sendMessage(tabName, followUpMsg);

        if (currentResult.error) {
          decisions.push(`❌ Follow-up failed with error`);
          return { status: 'failed', reason: currentResult.text, followUp: null };
        }
      } catch (err) {
        logger.error('Goal evaluation failed:', err);
        return { status: 'done', reason: 'Evaluation error — assuming done', followUp: null };
      }
    }

    decisions.push(`⚠️ Max follow-ups (${maxFollowUps}) reached`);
    return { status: 'partial', reason: `Reached max ${maxFollowUps} follow-ups`, followUp: null };
  }

  /** Learn from a completed conversation */
  private async learn(tabName: string, userMessage: string, response: string): Promise<void> {
    if (!response || response.length < 100) return;

    try {
      const existingFacts = this.memory.getKnowledge('', 10);
      const entries = await this.client.extractKnowledge(
        `User: ${userMessage}\n\nAssistant: ${response}`,
        existingFacts,
      );

      for (const entry of entries) {
        entry.tabName = tabName;
        this.memory.addKnowledge(entry);
      }

      if (entries.length > 0) {
        logger.info(`Pipe learned ${entries.length} facts from ${tabName}`);
      }
    } catch (err) {
      logger.error('Pipe learning error:', err);
    }
  }

  /** Discover projects on the filesystem */
  async discoverProjects(): Promise<number> {
    const projects = scanForProjects(this.config.pipe.projectScanPaths);
    for (const project of projects) {
      this.memory.upsertProject(project);
    }
    return projects.length;
  }
}
