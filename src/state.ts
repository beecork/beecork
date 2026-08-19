// Mutable runtime state shared across modules (the few things that change while
// the program runs). Kept in one object so any module can read/update it.

import { config } from "./config";
import type { TraceEntry } from "./types";

// Permission mode, rotated with Shift+Tab (see index.ts):
//   normal    — ask before each edit / command (default)
//   auto      — auto-approve edits & commands, BUT the per-CALL hard guard
//               (out-of-root paths, risky/destructive shell) STILL asks
//   readonly  — block all edits/commands; read, search and web only (safe explore, zero shell)
//   plan      — like readonly for mutations, but provably-safe read-only shell is allowed so the agent
//               can explore, then present a plan for approval (Explore-Plan-Act). Flip to normal to run it.
export type Mode = "normal" | "auto" | "readonly" | "plan";
const MODES: Mode[] = ["normal", "auto", "readonly", "plan"];
export function nextMode(m: Mode): Mode {
  return MODES[(MODES.indexOf(m) + 1) % MODES.length];
}
export function modeLabel(m: Mode): string {
  return m === "auto" ? "auto-approve" : m === "readonly" ? "read-only" : m === "plan" ? "plan" : "normal";
}

// Accepts what modeLabel() PRINTS as well as the internal token: the statusline and the prompt tag
// both show "read-only" / "auto-approve", so those were the spellings a user would copy — and the
// parser rejected them and fell back to "normal", i.e. a fully writing agent with no warning. In CI
// (BEECORK_MODE=read-only AUTO_APPROVE=1) that is a silent, total loss of the requested guarantee.
const MODE_ALIASES: Record<string, Mode> = { "read-only": "readonly", "auto-approve": "auto" };
export function parseMode(raw: string | undefined): Mode {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "normal";
  const m = MODE_ALIASES[v] ?? v;
  if (MODES.includes(m as Mode)) return m as Mode;
  console.error(`⚠ BEECORK_MODE="${raw}" is not a mode — using "normal". Valid: ${MODES.join(", ")}.`);
  return "normal";
}

export const state = {
  model: config.defaultModel, // changed at runtime via the /model command
  reasoningEffort: config.reasoningEffort, // "thinking" depth; changed live via /effort, persisted like /model
  apiKey: "", // resolved at startup in index.ts: shell env → ~/.beecork/config.json → prompt
  braveKey: "", // resolved at startup in index.ts: env / config.json (for web_search)
  // rotated with Shift+Tab; an initial mode can be set headlessly via BEECORK_MODE (for tests/eval)
  mode: parseMode(process.env.BEECORK_MODE),
};

// Tool-call trace, recorded only when config.traceFile is set (for the eval).
export const trace: TraceEntry[] = [];
