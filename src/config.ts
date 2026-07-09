// Central configuration. All tunable knobs live here, with production defaults;
// every numeric/flag knob can be overridden by an environment variable (the two
// endpoint URLs are constants).

// The OpenRouter key comes from a real shell env var OR (preferred) ~/.beecork/config.json via
// the /key prompt — NEVER from a project's .env file. beecork is a coding agent that runs INSIDE
// arbitrary projects; the key is the USER's, machine-level, so it must not pick up (or be confused
// by) whatever .env happens to sit in the working directory. Every knob below likewise reads ONLY
// the real shell environment, never a checked-in file (which a cloned repo could weaponize).
export const API_KEY = process.env.OPENROUTER_API_KEY ?? "";

// Curated starter models (shown by `/model` with no argument). Catalog data — lives here
// (config), not in the presentation module.
export const RECOMMENDED_MODELS: { slug: string; price: string; note: string }[] = [
  { slug: "deepseek/deepseek-v4-flash", price: "$0.09", note: "cheap + fast daily driver (default)" },
  { slug: "openai/gpt-5.4-nano", price: "$0.20", note: "cheap OpenAI" },
  { slug: "google/gemini-3.1-flash-lite", price: "$0.25", note: "cheap Google" },
  { slug: "z-ai/glm-4.7", price: "$0.40", note: "strong coder, great value" },
  { slug: "deepseek/deepseek-v4-pro", price: "$0.43", note: "stronger DeepSeek" },
  { slug: "z-ai/glm-5.2", price: "$0.95", note: "top agentic coder" },
  { slug: "anthropic/claude-haiku-4.5", price: "$1.00", note: "fast Claude" },
  { slug: "x-ai/grok-4.3", price: "$1.25", note: "xAI Grok" },
  { slug: "google/gemini-3.5-flash", price: "$1.50", note: "capable Google" },
  { slug: "anthropic/claude-sonnet-4.6", price: "$3.00", note: "top quality (premium)" },
  { slug: "openai/gpt-5.5", price: "$5.00", note: "OpenAI flagship (premium)" },
];

// Numeric env knob. Uses the fallback ONLY when unset/blank/non-numeric — so an
// explicit 0 (e.g. KEEP_RECENT=0) is honored, unlike `Number(env) || fallback`.
const num = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};
// Boolean env flag: ONLY explicit truthy values count. Plain Boolean() would treat
// AUTO_APPROVE=false (or =0) as true — failing OPEN, the opposite of what a user means.
const bool = (name: string) => ["1", "true", "yes", "on"].includes((process.env[name] ?? "").trim().toLowerCase());

// Reasoning ("thinking") effort. "off" disables thinking; low→max dial how deep the
// model reasons before answering. Sent via OpenRouter's UNIFIED `reasoning` param, so it
// works across every provider (deepseek/glm/gemini/claude/openai), not just one.
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max";
export const EFFORTS: ReasoningEffort[] = ["off", "low", "medium", "high", "max"];
// Parse a user-supplied effort (env/settings/command). Returns undefined for anything
// invalid so callers can fall back to the default rather than send a bad value.
export function normalizeEffort(raw: string | undefined | null): ReasoningEffort | undefined {
  const v = (raw ?? "").trim().toLowerCase();
  return (EFFORTS as string[]).includes(v) ? (v as ReasoningEffort) : undefined;
}

// Advanced escape hatch: arbitrary extra params merged into every request body
// (temperature, top_p, seed, provider routing, …). Malformed JSON → {} (ignored), so a
// typo can never break every request. Read ONLY from the real shell env, like every knob.
function parseExtra(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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
  loopRepeatLimit: num("LOOP_REPEAT_LIMIT", 3), // identical tool call N× → intervene
  retryAttempts: num("RETRY_ATTEMPTS", 3), // transient API failures
  apiTimeoutMs: num("API_TIMEOUT_MS", 180_000), // per-attempt model-call timeout (generous for reasoning models)

  // Tool operational limits
  execTimeoutMs: num("EXEC_TIMEOUT_MS", 30_000), // run_bash command timeout
  verifyTimeoutMs: num("VERIFY_TIMEOUT_MS", 60_000), // auto-check command timeout
  webTimeoutMs: num("WEB_TIMEOUT_MS", 20_000), // web_fetch / web_search timeout
  maxToolBuffer: num("MAX_TOOL_BUFFER", 1_000_000), // exec stdout/stderr byte cap
  searchMaxResults: num("SEARCH_MAX_RESULTS", 100), // search match cap
  searchTimeoutMs: num("SEARCH_TIMEOUT_MS", 5_000), // overall search traversal budget
  searchMaxFileBytes: num("SEARCH_MAX_FILE_BYTES", 2_000_000), // skip files larger than this

  // Reasoning / thinking
  reasoningEffort: normalizeEffort(process.env.REASONING_EFFORT) ?? ("medium" as ReasoningEffort), // startup default; changed live via /effort
  openRouterExtra: parseExtra(process.env.OPENROUTER_EXTRA), // advanced: extra request-body params (sampling, provider routing, …)

  // Background tasks (run_bash background:true → check_task / stop_task)
  maxBackgroundTasks: num("MAX_BG_TASKS", 5), // per-session cap on concurrent background commands
  backgroundTailChars: num("BG_TAIL_CHARS", 100_000), // rolling tail buffer per task (drops oldest)

  // Sub-agent (explore tool)
  subAgentMaxSteps: num("SUBAGENT_MAX_STEPS", 15), // child explorer's step budget (bounds cost/latency)

  // Pinned bottom UI: a persistent input box + a rich statusline (mode · model · effort · branch ·
  // ~tokens · bg tasks), the conversation scrolling above. DEFAULT ON for interactive TTYs; opt out
  // with STATUSLINE=0 (falls back to the classic inline editor). Non-TTY (piped/CI) is unaffected
  // either way — chromeEnabled() also requires a TTY.
  statuslineEnabled: !["0", "false", "off", "no"].includes((process.env.STATUSLINE ?? "").trim().toLowerCase()),
  statuslineRefreshMs: num("STATUSLINE_REFRESH_MS", 2000), // bar refresh interval

  // Integrations / modes
  verifyCommand: process.env.VERIFY_COMMAND ?? "", // auto-run after edits (e.g. "npm run typecheck")
  traceFile: process.env.TRACE_FILE ?? "", // record tool calls for the eval
  autoApprove: bool("AUTO_APPROVE"), // headless: skip permission prompts (explicit truthy only)

  // DANGER: skip the ENTIRE approval gate — out-of-root paths and risky shell just RUN, unprompted.
  // Claude-Code-style, for disposable sandboxes/CI only. Two floors still hold: an explicit read-only
  // mode still blocks writes, and the catastrophic-pattern refusal (rm -rf /, fork bomb, …) still fires.
  // Set via the --dangerously-skip-permissions CLI flag OR the env var; off by default.
  dangerouslySkipPermissions:
    bool("BEECORK_DANGEROUSLY_SKIP_PERMISSIONS") || process.argv.includes("--dangerously-skip-permissions"),
};
