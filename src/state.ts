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

export const state = {
  model: config.defaultModel, // changed at runtime via the /model command
  reasoningEffort: config.reasoningEffort, // "thinking" depth; changed live via /effort, persisted like /model
  apiKey: "", // resolved at startup in index.ts: shell env → ~/.beecork/config.json → prompt
  braveKey: "", // resolved at startup in index.ts: env / config.json (for web_search)
  // rotated with Shift+Tab; an initial mode can be set headlessly via BEECORK_MODE (for tests/eval)
  mode: (MODES.includes(process.env.BEECORK_MODE as Mode) ? (process.env.BEECORK_MODE as Mode) : "normal"),
};

// Tool-call trace, recorded only when config.traceFile is set (for the eval).
export const trace: TraceEntry[] = [];
