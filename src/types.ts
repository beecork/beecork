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
  mutates?: boolean; // writes to disk / changes state — blocked in read-only mode (even without needsApproval)
  // Per-CALL approval decision (e.g. a path outside the project root). Lets the
  // gate ask about this specific call, not just by tool name.
  guard?: (args: Record<string, any>) => { needsApproval?: boolean; reason?: string };
};

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

export type TraceEntry = { tool: string; args: string; step: number };
