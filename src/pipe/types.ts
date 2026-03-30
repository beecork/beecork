export interface Project {
  id: string;
  name: string;
  path: string;
  description: string;
  languages: string[];
  lastUsed: string | null;
  tabName: string | null;
  discoveredVia: 'scan' | 'conversation' | 'user';
  createdAt: string;
}

export interface RouteDecision {
  tabName: string;
  projectPath: string | null;
  confidence: number;
  reason: string;
  needsConfirmation: boolean;
}

export interface GoalEvaluation {
  status: 'done' | 'partial' | 'failed';
  reason: string;
  followUp: string | null;
}

export interface PermissionEntry {
  id: number;
  toolName: string;
  toolArgsPattern: string;
  decision: 'allow' | 'deny';
  confidence: number;
  context: string | null;
  tabName: string | null;
  createdAt: string;
}

export interface KnowledgeEntry {
  content: string;
  category: 'project' | 'preference' | 'decision' | 'fact';
  tabName: string | null;
  source: 'scan' | 'conversation' | 'user' | 'pipe';
}

export interface ChatContext {
  chatId: number;
  userId: number;
  messageId: number;
}

export interface PipeResult {
  tabName: string;
  response: { text: string; error: boolean; costUsd: number; durationMs: number };
  decisions: string[];
  goalStatus: GoalEvaluation | null;
}
