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

// Why a tool call did not succeed. These are DATA, not prose: the loop, the journal and the UI all
// branch on the code, never on how the message happens to be worded.
//   INVALID_ARGS — the model sent arguments the tool can't use (its own mistake; it can retry)
//   DENIED       — policy said no (approval refused, read-only/plan mode, headless hard-block)
//   CANCELLED    — the user interrupted, or the call never started because the turn was cut short
//   TIMEOUT      — the tool ran too long and was killed
//   NOT_FOUND    — no such tool
//   FAILED       — the tool ran and reported failure
export type ToolFailureCode = "INVALID_ARGS" | "DENIED" | "CANCELLED" | "TIMEOUT" | "NOT_FOUND" | "FAILED";

// A tool may return this instead of a string to say "I failed, and here is exactly how".
export type ToolFailure = { ok: false; code: ToolFailureCode; message: string; images?: ImagePart[]; retryable?: boolean };

// What a tool hands back: text for the model, optionally alongside images or a structured failure.
// Existing tools return a plain string and are unchanged (a string is a ToolResult).
export type ToolContent = string | { text: string; images: ImagePart[] }; // the success half
export type ToolResult = ToolContent | ToolFailure;

// The NORMALIZED result of one tool call — what runTool always returns, and the only shape the loop,
// the renderer and the journal ever see. Success and failure carry the same fields so every consumer
// can render one without asking which kind it is first.
export type ToolOutcome =
  | { ok: true; text: string; images: ImagePart[] }
  | { ok: false; code: ToolFailureCode; text: string; images: ImagePart[]; retryable: boolean };

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
  // Returns text shown to the model (optionally with images — see ToolResult). To report a failure,
  // PREFER returning a structured `ToolFailure` ({ ok: false, code, message }). A plain string whose
  // text begins with "Error" is still accepted and is normalized to { ok: false, code: "FAILED" } —
  // that legacy form is an INPUT convention only, never something beecork branches on downstream.
  // signal = user cancel (Ctrl-C).
  run: (args: Record<string, any>, signal?: AbortSignal) => Promise<ToolResult>;
  // May a run of these calls execute CONCURRENTLY with its neighbours?
  //   "parallel"  — independent and side-effect-free; safe to run alongside others
  //   "exclusive" — a barrier: everything before it settles first, and it runs alone (the DEFAULT,
  //                 because "I didn't think about it" must never mean "run it concurrently")
  // This lives on the tool because only the tool knows. It used to be a hardcoded list of names in
  // agent.ts, which meant no MCP tool could ever be parallel however read-only it was, and every new
  // built-in was serial until someone remembered to add it to a set in another file.
  execution?: "parallel" | "exclusive";
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
