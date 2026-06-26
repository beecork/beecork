// Mutable runtime state shared across modules (the few things that change while
// the program runs). Kept in one object so any module can read/update it.

import { config } from "./config";
import type { TraceEntry } from "./types";

export const state = {
  model: config.defaultModel, // changed at runtime via the /model command
  apiKey: "", // resolved at startup in index.ts: env/.env → ~/.beecork/config.json → prompt
  braveKey: "", // resolved at startup in index.ts: env / config.json (for web_search)
};

// Tool-call trace, recorded only when config.traceFile is set (for the eval).
export const trace: TraceEntry[] = [];
