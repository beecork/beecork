import { classifyTool, type ToolRisk } from './tool-classifier.js';
import { logger } from '../util/logger.js';
import type { ApprovalMode, StreamContentToolUse } from '../types.js';

export interface ApprovalRequest {
  tabName: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  risk: ToolRisk;
  description: string;
}

export type ApprovalCallback = (request: ApprovalRequest) => Promise<boolean>;

export class ApprovalManager {
  constructor(
    private mode: ApprovalMode,
    private tabName: string,
    private onApprovalNeeded: ApprovalCallback | null,
    private timeoutMs: number = 30 * 60 * 1000, // 30 minutes
  ) {}

  /** Check if a tool call should proceed. Returns true if approved. */
  async shouldApprove(toolUse: StreamContentToolUse): Promise<boolean> {
    if (this.mode === 'yolo') return true;

    const risk = classifyTool(toolUse.name, toolUse.input as Record<string, unknown>);

    if (this.mode === 'auto-safe' && risk === 'safe') {
      logger.debug(`[${this.tabName}] Auto-approved safe tool: ${toolUse.name}`);
      return true;
    }

    // Need user approval
    if (!this.onApprovalNeeded) {
      logger.warn(`[${this.tabName}] Approval needed but no callback set — rejecting ${toolUse.name}`);
      return false;
    }

    const request: ApprovalRequest = {
      tabName: this.tabName,
      toolName: toolUse.name,
      toolArgs: toolUse.input as Record<string, unknown>,
      risk,
      description: formatToolDescription(toolUse),
    };

    // Wait for user response with timeout
    try {
      const result = await Promise.race([
        this.onApprovalNeeded(request),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('Approval timeout')), this.timeoutMs)
        ),
      ]);
      return result;
    } catch (err) {
      logger.warn(`[${this.tabName}] Approval timed out for ${toolUse.name}`);
      return false;
    }
  }
}

function formatToolDescription(toolUse: StreamContentToolUse): string {
  const input = toolUse.input as Record<string, unknown>;
  if (toolUse.name === 'Bash') {
    return `Run command: ${String(input.command || '').slice(0, 200)}`;
  }
  if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
    return `${toolUse.name}: ${String(input.file_path || '')}`;
  }
  return `${toolUse.name}: ${JSON.stringify(input).slice(0, 200)}`;
}
