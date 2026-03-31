/** Reserved for future approval mode implementation. Not currently wired into the runtime. */
export type ToolRisk = 'safe' | 'dangerous';

const SAFE_TOOLS = new Set([
  'Read', 'Glob', 'Grep', 'LSP', 'WebFetch', 'WebSearch',
  'ToolSearch', 'TaskGet', 'TaskList',
]);

const DANGEROUS_TOOLS = new Set([
  'Write', 'Edit', 'NotebookEdit',
  'TaskCreate', 'TaskUpdate', 'TaskStop',
]);

const SAFE_BASH_PATTERNS = [
  /^(ls|cat|head|tail|wc|file|stat|which|type|echo|printf)\b/,
  /^git\s+(status|log|diff|show|branch|tag|remote)\b/,
  /^(pwd|whoami|hostname|date|uname|env|printenv)\b/,
  /^(find|grep|rg|fd|ag)\b/,
  /^(node|python|ruby|go)\s+--?(version|help)/,
  /^npm\s+(list|ls|view|info|outdated|audit)\b/,
  /^curl\s.*-X\s*GET\b/,
  /^curl\s+(?!.*-X\s*(POST|PUT|DELETE|PATCH))(?!.*--data)(?!.*-d\s)/,
];

const DANGEROUS_BASH_PATTERNS = [
  /^rm\b/,
  /^(mv|cp)\b.*--?(force|f)\b/,
  /^chmod\b/,
  /^chown\b/,
  /^git\s+(push|reset|rebase|merge|checkout\s+--)\b/,
  /^(docker|kubectl|terraform|ansible)\b/,
  /^(sudo|su)\b/,
  /^npm\s+(publish|install|uninstall|link)\b/,
  /^(kill|killall|pkill)\b/,
  /^curl\s.*-X\s*(POST|PUT|DELETE|PATCH)\b/,
];

/** Classify a tool call as safe or dangerous */
export function classifyTool(toolName: string, input: Record<string, unknown>): ToolRisk {
  if (SAFE_TOOLS.has(toolName)) return 'safe';
  if (DANGEROUS_TOOLS.has(toolName)) return 'dangerous';

  // Bash tool: inspect the command
  if (toolName === 'Bash') {
    const command = String(input.command || '').trim();
    for (const pattern of SAFE_BASH_PATTERNS) {
      if (pattern.test(command)) return 'safe';
    }
    for (const pattern of DANGEROUS_BASH_PATTERNS) {
      if (pattern.test(command)) return 'dangerous';
    }
    // Default: unknown bash commands are dangerous
    return 'dangerous';
  }

  // MCP tools from external servers: default to dangerous
  if (toolName.startsWith('mcp__')) return 'dangerous';

  // Unknown tools: default to dangerous
  return 'dangerous';
}
