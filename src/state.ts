// Mutable runtime state shared across modules (the few things that change while
// the program runs). Kept in one object so any module can read/update it.

import { config } from "./config";
import type { TraceEntry } from "./types";

// Permission mode, rotated with Shift+Tab (see index.ts):
//   normal    — ask before each edit / command (default)
//   auto      — auto-approve edits & commands, BUT the per-CALL hard guard
//               (out-of-root paths, risky/destructive shell) STILL asks
//   readonly  — block all edits/commands; read, search and web only (safe explore)
export type Mode = "normal" | "auto" | "readonly";
const MODES: Mode[] = ["normal", "auto", "readonly"];
export function nextMode(m: Mode): Mode {
  return MODES[(MODES.indexOf(m) + 1) % MODES.length];
}
export function modeLabel(m: Mode): string {
  return m === "auto" ? "auto-approve" : m === "readonly" ? "read-only" : "normal";
}

export const state = {
  model: config.defaultModel, // changed at runtime via the /model command
  apiKey: "", // resolved at startup in index.ts: env/.env → ~/.beecork/config.json → prompt
  braveKey: "", // resolved at startup in index.ts: env / config.json (for web_search)
  mode: "normal" as Mode, // rotated with Shift+Tab
};

// Tool-call trace, recorded only when config.traceFile is set (for the eval).
export const trace: TraceEntry[] = [];
