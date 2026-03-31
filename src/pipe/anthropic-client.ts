import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../util/logger.js';
import type { RouteDecision, GoalEvaluation, KnowledgeEntry, Project } from './types.js';

export class PipeAnthropicClient {
  private client: Anthropic;
  private routingModel: string;
  private complexModel: string;

  constructor(apiKey: string, routingModel: string, complexModel: string) {
    this.client = new Anthropic({ apiKey });
    this.routingModel = routingModel;
    this.complexModel = complexModel;
  }

  /** Route a message to the right project/tab (Haiku — fast, cheap) */
  async route(message: string, projects: Project[], recentRouting: string[]): Promise<RouteDecision> {
    const projectList = projects.map(p =>
      `- ${p.name}: ${p.path}${p.languages?.length ? ` (${p.languages.join(', ')})` : ''}${p.description ? ` — ${p.description}` : ''}`
    ).join('\n');

    const response = await this.complete(
      `You are a message router. Given a user message, determine which project it relates to.

Available projects:
${projectList || '(no projects discovered yet)'}

Recent routing decisions:
${recentRouting.slice(0, 5).join('\n') || '(none)'}

Respond with ONLY valid JSON: {"tabName": "project-name", "projectPath": "/path", "confidence": 0.0-1.0, "reason": "brief explanation", "needsConfirmation": false}

If the message is a general question not related to any project, use tabName "default" with the user's home directory.
If unsure which project, set confidence below 0.5 and needsConfirmation to true.`,
      message,
      'haiku',
    );

    try {
      return JSON.parse(response);
    } catch {
      return { tabName: 'default', projectPath: null, confidence: 0.3, reason: 'Could not parse routing', needsConfirmation: true };
    }
  }

  /** Evaluate if a goal was achieved (Sonnet — needs reasoning) */
  async evaluateGoal(originalGoal: string, response: string): Promise<GoalEvaluation> {
    const result = await this.complete(
      `You evaluate whether a coding assistant achieved a user's goal.

Respond with ONLY valid JSON: {"status": "done|partial|failed", "reason": "brief explanation", "followUp": "what to do next" or null}

Consider:
- Did it actually make changes, or just describe what to do?
- Did it complete the full task or just one step?
- Are there obvious remaining steps?

If the response is a simple answer to a question (not a task), status is "done".`,
      `Original goal: "${originalGoal}"\n\nAssistant's response:\n${response.slice(0, 3000)}`,
      'sonnet',
    );

    try {
      return JSON.parse(result);
    } catch {
      return { status: 'done', reason: 'Could not evaluate', followUp: null };
    }
  }

  /** Extract knowledge from a conversation (Haiku — fast) */
  async extractKnowledge(conversation: string, existingFacts: string[]): Promise<KnowledgeEntry[]> {
    const response = await this.complete(
      `Extract structured knowledge from this conversation worth remembering across sessions.

Already known facts:
${existingFacts.slice(0, 10).join('\n') || '(none)'}

Respond with ONLY a valid JSON array: [{"content": "...", "category": "project|preference|decision|fact"}]
Return [] if nothing new is worth remembering. Max 5 entries.`,
      conversation.slice(0, 5000),
      'haiku',
    );

    try {
      const entries = JSON.parse(response);
      if (Array.isArray(entries)) {
        return entries.slice(0, 5).map((e: { content: string; category: string }) => ({
          content: e.content,
          category: (e.category || 'fact') as KnowledgeEntry['category'],
          tabName: null,
          source: 'pipe' as const,
        }));
      }
      return [];
    } catch {
      return [];
    }
  }

  private async complete(systemPrompt: string, userMessage: string, model: 'haiku' | 'sonnet'): Promise<string> {
    const modelId = model === 'haiku' ? this.routingModel : this.complexModel;
    try {
      const response = await this.client.messages.create({
        model: modelId,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }, { timeout: 30000 });

      const textBlock = response.content.find(b => b.type === 'text');
      return textBlock?.text ?? '';
    } catch (err) {
      logger.error(`Pipe API call failed (${model}):`, err);
      throw err;
    }
  }
}
