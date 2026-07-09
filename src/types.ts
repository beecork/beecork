// Shared types.

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is a JSON string
};

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  // The model's reasoning ("thinking") for THIS assistant message, captured from the stream.
  // Some providers (e.g. Anthropic) require the thinking block be resent alongside the
  // tool_calls it produced, or the follow-up request in a multi-step turn errors — so we keep
  // it here and replay it for the current turn's tool chain (pruned from older turns to save
  // tokens; see pruneReasoningForSend in api.ts). `reasoning` is the plaintext; `reasoning_details`
  // is the structured form that MUST be resent verbatim (it carries provider signatures).
  reasoning?: string;
  reasoning_details?: unknown[];
};

// A tool: the schema the model sees + the function that runs it.
export type ToolDef = {
  name: string;
  description: string;
  parameters: object; // JSON Schema for the arguments
  // Returns a string shown to the model. CONTRACT: an error/failure result MUST begin with
  // "Error" — the agent loop + ui.summarizeResult detect failure by that prefix. signal = user cancel (Ctrl-C).
  run: (args: Record<string, any>, signal?: AbortSignal) => Promise<string>;
  needsApproval?: boolean; // dangerous tools must be approved before running
  alwaysAsk?: boolean; // confirm EVERY time — never "always"-cached (e.g. run_bash, so its explanation is always seen)
  mutates?: boolean; // writes to disk / changes state — blocked in read-only mode (even without needsApproval)
  // Per-CALL approval decision (e.g. a path outside the project root). Lets the
  // gate ask about this specific call, not just by tool name. `cacheKey`, when present,
  // makes an "always" answer stick for THIS key (e.g. one out-of-root path) for the session
  // only — never persisted. Absent (secrets, risky shell) → never cacheable.
  guard?: (args: Record<string, any>) => { needsApproval?: boolean; reason?: string; cacheKey?: string };
};

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

export type TraceEntry = { tool: string; args: string; step: number };
