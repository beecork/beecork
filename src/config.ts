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
  { slug: "qwen/qwen3-coder-next", price: "$0.11", note: "cheap coding specialist (Qwen)" },
  { slug: "qwen/qwen3.6-flash", price: "$0.19", note: "fast Qwen — great value (thinking)" },
  { slug: "openai/gpt-5.4-nano", price: "$0.20", note: "cheap OpenAI" },
  { slug: "google/gemini-3.1-flash-lite", price: "$0.25", note: "cheap Google" },
  { slug: "qwen/qwen3.7-plus", price: "$0.32", note: "strong Qwen (thinking)" },
  { slug: "deepseek/deepseek-v4-pro", price: "$0.43", note: "stronger DeepSeek" },
  { slug: "z-ai/glm-5", price: "$0.60", note: "strong coder, great value" },
  { slug: "z-ai/glm-5.2", price: "$0.93", note: "top agentic coder" },
  { slug: "anthropic/claude-haiku-4.5", price: "$1.00", note: "fast Claude" },
  { slug: "google/gemini-3.5-flash", price: "$1.50", note: "capable Google" },
  { slug: "anthropic/claude-sonnet-5", price: "$2.00", note: "top quality (premium)" },
  { slug: "x-ai/grok-4.5", price: "$2.00", note: "xAI Grok (latest)" },
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

// OpenRouter provider-routing sort. The SAME model is served by many backends with wildly different
// time-to-first-token; "latency" routes to the fastest-responding one. "" disables it (OpenRouter's
// own load-balanced routing). UNSET → "latency" (the fast default); an explicit off/none/default → "";
// a typo → "latency" rather than sending a bad value.
export type ProviderSort = "" | "price" | "throughput" | "latency";
export function normalizeProviderSort(raw: string | undefined | null): ProviderSort {
  if (raw == null) return "latency";
  const v = raw.trim().toLowerCase();
  if (v === "latency" || v === "price" || v === "throughput") return v;
  if (["", "off", "none", "default", "0", "false", "no"].includes(v)) return "";
  return "latency";
}

// Advanced escape hatch: arbitrary extra params merged into every request body
// (temperature, top_p, seed, provider routing, …). Malformed JSON → {} (ignored), so a
// typo can never break every request. Read ONLY from the real shell env, like every knob.
export function parseExtra(raw: string | undefined): Record<string, unknown> { // exported for tests
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

  // Images. maxToolResultChars deliberately does NOT apply to image payloads (they never enter the
  // text, so they can't be sliced into invalid base64); these four bounded caps replace it.
  imageTokenCost: num("IMAGE_TOKEN_COST", 1200), // flat per-image estimate — an image costs a fixed-ish
  // count per tile, never bytes/4. Real range across providers is ~750–1600 (OpenAI tiled ≈1105 for a
  // 1440×900, Anthropic w*h/750 ≈1584, Gemini ≈516–1032). Deliberately mid-HIGH: over-estimating
  // compacts a little early (cheap), under-estimating means the provider rejects the whole turn.
  maxImageBytes: num("MAX_IMAGE_BYTES", 5_000_000), // per image, RAW bytes (base64 inflates ~1.37×)
  maxImagesPerMessage: num("MAX_IMAGES_PER_MESSAGE", 4), // per user prompt AND per assistant step
  maxLiveImages: num("MAX_LIVE_IMAGES", 4), // images kept in the live conversation — the real backstop

  // MCP (external tool servers, configured in ~/.beecork/settings.json). Off-switch is env-only so
  // a repo can never silently enable it; the server LIST is likewise global-file-only (see memory.ts).
  mcpEnabled: !["0", "false", "off", "no"].includes((process.env.MCP ?? "").trim().toLowerCase()),
  mcpStartupTimeoutMs: num("MCP_STARTUP_TIMEOUT_MS", 15_000), // cold `npx` can be slow the first time
  mcpRequestTimeoutMs: num("MCP_REQUEST_TIMEOUT_MS", 60_000),
  mcpReadyWaitMs: num("MCP_READY_WAIT_MS", 1_500), // bounded wait at turn start, never at startup
  mcpMaxToolsPerServer: num("MCP_MAX_TOOLS", 64), // a huge server would otherwise swamp the tool schema
  mcpMaxMessageBytes: num("MCP_MAX_MESSAGE_BYTES", 8_000_000),
  mcpShutdownGraceMs: num("MCP_SHUTDOWN_GRACE_MS", 1_500),

  // Context management
  maxContextTokens: num("MAX_CONTEXT_TOKENS", 128_000), // compact above this (a CEILING — see contextBudget)
  // Headroom kept free INSIDE the model's advertised window for the reply itself plus any hidden
  // reasoning tokens. The window has to hold prompt + completion; budgeting the whole thing for the
  // prompt is how a request that "fits" still 400s on a thinking model.
  outputReserveTokens: num("OUTPUT_RESERVE_TOKENS", 16_000),
  keepRecent: num("KEEP_RECENT", 12), // recent messages kept verbatim
  maxToolResultChars: num("MAX_TOOL_RESULT_CHARS", 20_000), // cap a single tool output

  // Long-term memory (the `remember` tool → .beecork/memory.md). The read-side budget truncates a
  // single memory file at 8k chars, so keep the write budget well under that so memory is never lost.
  memoryMaxChars: num("MEMORY_MAX_CHARS", 4000), // over budget → remember refuses + asks the model to consolidate
  memoryNudgeInterval: num("MEMORY_NUDGE_INTERVAL", 8), // every N user turns, remind the model to save durable facts (0 = off)

  // Agentic loop
  maxSteps: num("MAX_STEPS", 50), // tool steps per turn (runaway guard)
  loopRepeatLimit: num("LOOP_REPEAT_LIMIT", 3), // identical tool call N× → intervene
  retryAttempts: num("RETRY_ATTEMPTS", 3), // transient API failures
  apiTimeoutMs: num("API_TIMEOUT_MS", 180_000), // per-attempt model-call timeout (generous for reasoning models)
  // Run a batch's independent, read-only tool calls (read_file/search/list_dir/web_fetch/…) CONCURRENTLY
  // instead of one-at-a-time — the model is told to batch independent calls, so this cashes in the win
  // (N web_fetches take ~1× instead of N×). Mutating/approval/interactive tools always stay serial.
  parallelTools: !["0", "false", "off", "no"].includes((process.env.PARALLEL_TOOLS ?? "").trim().toLowerCase()),
  // Upper bound on how many of those run at once. The batch size is chosen by the MODEL, so without a
  // cap a single message asking for 200 web_fetches would open 200 sockets at once — enough to get
  // rate-limited, hit the open-file limit, or stall the machine. Results are still committed in the
  // model's original call order regardless of how they're chunked.
  maxParallelTools: Math.max(1, num("MAX_PARALLEL_TOOLS", 8)),

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

  // Provider routing (overridable by a `provider` block in OPENROUTER_EXTRA). The same model is served
  // by many OpenRouter backends with very different time-to-first-token; "latency" (the default) routes
  // to the fastest-responding one so replies start streaming right away instead of stalling on a slow
  // provider. Set OPENROUTER_PROVIDER_SORT=off to fall back to OpenRouter's default load-balanced routing.
  providerSort: normalizeProviderSort(process.env.OPENROUTER_PROVIDER_SORT),

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

  // Graduated approval: auto-approve provably-safe, read-only, in-root shell commands (no metacharacters)
  // so `ls`/`cat`/`git status` don't prompt like `rm` does — cutting the approval fatigue that makes the
  // gate unreliable. Deny-first: anything not provably safe still asks. Default on; SAFE_BASH_APPROVE=0
  // reverts to prompting for every shell command.
  safeBashAutoApprove: !["0", "false", "off", "no"].includes((process.env.SAFE_BASH_APPROVE ?? "").trim().toLowerCase()),

  // Integrations / modes
  verifyCommand: process.env.VERIFY_COMMAND ?? "", // auto-run after edits (e.g. "npm run typecheck")
  traceFile: process.env.TRACE_FILE ?? "", // record tool calls for the eval

  // The execution journal (.beecork/journal/*.jsonl) — an append-only record of what the agent did.
  // Local-only, never transmitted (identity #5: no phone-home); BEECORK_JOURNAL=0 turns it off.
  // OS-level confinement for MODEL-CHOSEN commands (run_bash, background tasks).
  //   auto (default) — confine when a working runner exists; otherwise warn ONCE and carry on
  //   on             — confinement is REQUIRED; refuse to run commands when it isn't available
  //   off            — no sandbox (policy layers still apply)
  // `auto` rather than `on` by default because macOS always has sandbox-exec (so Macs are confined
  // out of the box) while a Linux box without bubblewrap would otherwise lose run_bash on upgrade.
  sandboxMode: (["on", "off", "auto"].includes((process.env.BEECORK_SANDBOX ?? "").trim().toLowerCase())
    ? (process.env.BEECORK_SANDBOX ?? "").trim().toLowerCase()
    : "auto") as "on" | "off" | "auto",

  journalEnabled: !["0", "false", "off", "no"].includes((process.env.BEECORK_JOURNAL ?? "").trim().toLowerCase()),
  maxJournals: num("MAX_JOURNALS", 50), // per project, like sessions
  autoApprove: bool("AUTO_APPROVE"), // headless: skip permission prompts (explicit truthy only)

  // DANGER: skip the ENTIRE approval gate — out-of-root paths and risky shell just RUN, unprompted.
  // Claude-Code-style, for disposable sandboxes/CI only. Two floors still hold: an explicit read-only
  // mode still blocks writes, and the catastrophic-pattern refusal (rm -rf /, fork bomb, …) still fires.
  // Set via the --dangerously-skip-permissions CLI flag OR the env var; off by default.
  dangerouslySkipPermissions:
    bool("BEECORK_DANGEROUSLY_SKIP_PERMISSIONS") || process.argv.includes("--dangerously-skip-permissions"),
};
