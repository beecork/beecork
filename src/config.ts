// Central configuration. All tunable knobs live here, with production defaults;
// every one can be overridden by an environment variable.

// Load OPENROUTER_API_KEY (and any other vars) from a local .env, if present.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env — the key may be set some other way
}

export const API_KEY = process.env.OPENROUTER_API_KEY ?? "";

const num = (name: string, fallback: number) => Number(process.env[name]) || fallback;

export const config = {
  apiUrl: "https://openrouter.ai/api/v1/chat/completions",
  modelsUrl: "https://openrouter.ai/api/v1/models",
  defaultModel: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",

  // Context management
  maxContextTokens: num("MAX_CONTEXT_TOKENS", 128_000), // compact above this
  keepRecent: num("KEEP_RECENT", 12), // recent messages kept verbatim
  maxToolResultChars: num("MAX_TOOL_RESULT_CHARS", 20_000), // cap a single tool output

  // Agentic loop
  maxSteps: num("MAX_STEPS", 50), // tool steps per turn (runaway guard)
  loopRepeatLimit: 3, // identical tool call N× → intervene
  retryAttempts: 3, // transient API failures

  // Integrations / modes
  verifyCommand: process.env.VERIFY_COMMAND ?? "", // auto-run after edits (e.g. "npm run typecheck")
  traceFile: process.env.TRACE_FILE ?? "", // record tool calls for the eval
  autoApprove: Boolean(process.env.AUTO_APPROVE), // headless: skip permission prompts
};
