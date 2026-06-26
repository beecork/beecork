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
try {
  const fromFile = parseEnv(readFileSync(".env", "utf8")) as Record<string, string>;
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] === undefined && fromFile[key] !== undefined) process.env[key] = fromFile[key];
  }
} catch {
  // no .env (or unreadable) — the key may be set some other way
}

export const API_KEY = process.env.OPENROUTER_API_KEY ?? "";

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

  // Tool operational limits
  execTimeoutMs: num("EXEC_TIMEOUT_MS", 30_000), // run_bash command timeout
  verifyTimeoutMs: num("VERIFY_TIMEOUT_MS", 60_000), // auto-check command timeout
  webTimeoutMs: num("WEB_TIMEOUT_MS", 20_000), // web_fetch / web_search timeout
  maxToolBuffer: num("MAX_TOOL_BUFFER", 1_000_000), // exec stdout/stderr byte cap
  searchMaxResults: num("SEARCH_MAX_RESULTS", 100), // search match cap

  // Integrations / modes
  verifyCommand: process.env.VERIFY_COMMAND ?? "", // auto-run after edits (e.g. "npm run typecheck")
  traceFile: process.env.TRACE_FILE ?? "", // record tool calls for the eval
  autoApprove: bool("AUTO_APPROVE"), // headless: skip permission prompts (explicit truthy only)
};
