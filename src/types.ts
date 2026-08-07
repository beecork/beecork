// Shared types.

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string }; // arguments is a JSON string
};

// Message content is normally plain text; an array is the OpenAI-shaped multi-part form used to
// carry images. INVARIANT: parts appear ONLY on role:"user" messages. OpenRouter documents image
// parts on user messages only — role:"tool" content is a string on every route — so a tool that
// returns an image has it flushed into a synthesized user message instead (see agent.ts). Putting
// images in the tool message would work on some providers and hard-400 on others.
export type TextPart = { type: "text"; text: string };
export type ImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
export type ContentPart = TextPart | ImagePart;
export type Content = string | ContentPart[] | null;

// What a tool hands back: text for the model, optionally alongside images. Existing tools return a
// plain string and are unchanged (a string is a ToolResult).
export type ToolResult = string | { text: string; images: ImagePart[] };

export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: Content;
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
  // beecork-INTERNAL, never sent to the provider: marks a user message we synthesized to carry
  // images a tool returned. pruneReasoningForSend skips these when locating the "last user message"
  // (otherwise it would strip the thinking block off the assistant turn that made the tool calls)
  // and deletes the flag from the outgoing copy.
  attached?: true;
};

// A tool: the schema the model sees + the function that runs it.
export type ToolDef = {
  name: string;
  description: string;
  parameters: object; // JSON Schema for the arguments
  // Returns text shown to the model (optionally with images — see ToolResult). CONTRACT: an
  // error/failure result's TEXT MUST begin with "Error" — the agent loop + ui.summarizeResult
  // detect failure by that prefix. signal = user cancel (Ctrl-C).
  run: (args: Record<string, any>, signal?: AbortSignal) => Promise<ToolResult>;
  needsApproval?: boolean; // dangerous tools must be approved before running
  alwaysAsk?: boolean; // confirm EVERY time — never "always"-cached (e.g. run_bash, so its explanation is always seen)
  mutates?: boolean; // writes to disk / changes state — blocked in read-only mode (even without needsApproval)
  // Per-CALL approval decision (e.g. a path outside the project root). Lets the
  // gate ask about this specific call, not just by tool name. `cacheKey`, when present,
  // makes an "always" answer stick for THIS key (e.g. one out-of-root path) for the session
  // only — never persisted. Absent (secrets, risky shell) → never cacheable.
  guard?: (args: Record<string, any>) => { needsApproval?: boolean; reason?: string; cacheKey?: string };
  // Graduated approval: return true when THIS specific call is provably safe to run without asking
  // (e.g. a read-only, in-root shell command with no metacharacters). Deny-first — anything not
  // provably safe returns false and falls through to the normal prompt. Checked AFTER the hard guard,
  // so a risky/out-of-root call still asks. Does not apply in read-only mode.
  safeAutoApprove?: (args: Record<string, any>) => boolean;
};

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

export type TraceEntry = { tool: string; args: string; step: number };
