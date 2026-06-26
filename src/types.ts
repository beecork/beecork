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
  run: (args: Record<string, any>) => Promise<string>;
  needsApproval?: boolean; // dangerous tools must be approved before running
};

export type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" };

export type TraceEntry = { tool: string; args: string; step: number };
