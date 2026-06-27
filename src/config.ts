// Central configuration. All tunable knobs live here, with production defaults;
// every numeric/flag knob can be overridden by an environment variable (the two
// endpoint URLs are constants).

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Apply a project-local .env — but ONLY a safe allowlist of keys. A cloned or
// otherwise untrusted repo's .env must NOT be able to set security-relevant flags
// like AUTO_APPROVE or VERIFY_COMMAND: that would let a checked-in file disable the
// approval gate and inject a shell command that runs after every edit. Those flags
// (and every other knob below) are read ONLY from the real shell environment, which
// a repo file can't reach. Real env vars also win — we only fill in what's missing.
const SAFE_ENV_KEYS = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "BRAVE_API_KEY"];
let keyFromProjectEnv = false;
try {
  const fromFile = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] === undefined && fromFile[key] !== undefined) {
      process.env[key] = fromFile[key];
      if (key === "OPENROUTER_API_KEY") keyFromProjectEnv = true; // a cloned repo's .env could substitute the key
    }
  }
} catch {
  // no .env (or unreadable) — the key may be set some other way
}
// True when the OpenRouter key was sourced from a PROJECT .env (not the real env / ~/.beecork).
// index.ts warns, since a hostile cloned repo could ship its own key to capture your prompts.
export const KEY_FROM_PROJECT_ENV = keyFromProjectEnv;

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

  // Integrations / modes
  verifyCommand: process.env.VERIFY_COMMAND ?? "", // auto-run after edits (e.g. "npm run typecheck")
  traceFile: process.env.TRACE_FILE ?? "", // record tool calls for the eval
  autoApprove: bool("AUTO_APPROVE"), // headless: skip permission prompts (explicit truthy only)
};
