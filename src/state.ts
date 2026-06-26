// Mutable runtime state shared across modules (the few things that change while
// the program runs). Kept in one object so any module can read/update it.

import { config } from "./config";
import type { TraceEntry } from "./types";

export const state = {
  model: config.defaultModel, // changed at runtime via the /model command
};

// Tool-call trace, recorded only when config.traceFile is set (for the eval).
export const trace: TraceEntry[] = [];
