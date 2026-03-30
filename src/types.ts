// ─── Config ───

export interface TelegramConfig {
  token: string;
  allowedUserIds: number[];
  adminUserId?: number; // Defaults to allowedUserIds[0]
}

export interface ClaudeCodeConfig {
  bin: string;
  defaultFlags: string[];
  maxBudgetUsd?: number;
}

export interface MemoryConfig {
  enabled: boolean;
  dbPath: string;
  maxLongTermEntries: number;
}

export interface TabConfig {
  workingDir: string;
  /** Reserved for future use. Currently has no effect — all sessions run in 'yolo' mode. */
  approvalMode: ApprovalMode;
  /** Reserved for future use. Currently has no effect. */
  approvalTimeoutMinutes: number;
}

export type ApprovalMode = 'yolo' | 'ask' | 'auto-safe';

export interface WhatsAppConfig {
  enabled: boolean;
  mode: 'baileys';
  sessionPath: string;
  allowedNumbers: string[];
}

export interface PipeConfig {
  enabled: boolean;
  anthropicApiKey: string;
  routingModel: string;
  complexModel: string;
  confidenceThreshold: number;
  projectScanPaths: string[];
  maxFollowUps: number;
}

export interface BeecorkConfig {
  telegram: TelegramConfig;
  whatsapp?: WhatsAppConfig;
  claudeCode: ClaudeCodeConfig;
  tabs: Record<string, TabConfig>;
  memory: MemoryConfig;
  pipe: PipeConfig;
  deployment: 'local' | 'vps';
}

// ─── Tab State ───

export type TabStatus = 'idle' | 'running' | 'error' | 'stopped';

export interface Tab {
  id: string;
  name: string;
  sessionId: string;
  status: TabStatus;
  workingDir: string;
  createdAt: string;
  lastActivityAt: string;
  pid: number | null;
}

// ─── Stream JSON Types (from claude CLI --output-format=stream-json) ��──

export interface StreamInit {
  type: 'system';
  subtype: 'init';
  session_id: string;
  tools: string[];
  mcp_servers: string[];
  model: string;
}

export interface StreamContentText {
  type: 'text';
  text: string;
}

export interface StreamContentToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface StreamContentToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type StreamContentBlock =
  | StreamContentText
  | StreamContentToolUse
  | StreamContentToolResult;

export interface StreamAssistant {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: StreamContentBlock[];
    stop_reason: string;
    usage: StreamUsage;
  };
  session_id: string;
}

export interface StreamResult {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: StreamUsage;
}

export interface StreamUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type StreamEvent = StreamInit | StreamAssistant | StreamResult;

// ─── Cron ───

export type CronScheduleType = 'at' | 'every' | 'cron';

export type CronPayloadType = 'agentTurn' | 'systemEvent';

export interface CronJob {
  id: string;
  name: string;
  scheduleType: CronScheduleType;
  schedule: string;
  tabName: string;
  message: string;
  payloadType: CronPayloadType;
  enabled: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

// ─── Memory ───

export interface Memory {
  id: number;
  content: string;
  tabName: string | null;
  createdAt: string;
  source: 'tool' | 'auto';
}

// ─── Circuit Breaker ───

export interface CircuitBreakerConfig {
  maxRepeats: number;
  windowSize: number;
}

// Note: Channel interface is handled via NotifyCallback in src/session/manager.ts
