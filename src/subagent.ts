// Sub-agent: the `explore` tool spawns a focused, READ-ONLY child agent that investigates on its own
// (read/search/list + web) and returns a concise written summary — keeping the PARENT's context clean
// (context isolation). It reuses beecork's safe LEAF primitives (callModel, runTool, decideApproval,
// the same toolDefs) rather than the parent orchestrator, so it stays small and can't drift.
//
// SAFETY (the load-bearing design): path confinement is NOT in the tools — it lives in decideApproval's
// guard check. So the child is confined two ways: (1) every tool call is gated through the pure
// decideApproval with {mode:"readonly", autoApprove:true} → in-root non-secret reads run, out-of-root /
// secret reads are DENIED (no prompt); (2) dispatch uses a RESTRICTED map → an emitted write_file /
// run_bash resolves to "unknown tool" and never runs. `explore` itself is excluded from the child set,
// so it cannot recurse.

import type { Message, ToolCall, ToolDef } from "./types";
import { config } from "./config";
import { color, stripControl } from "./ui";
import { callModel } from "./api";
import { runTool, toolDefs } from "./tools";
import { decideApproval } from "./agent";

// The child's ALLOW-LIST — read/search/list + web. Deliberately excludes every mutating tool AND
// `explore` itself (no recursion). Exported so a test can assert the read-only + depth-1 guarantee.
export const EXPLORER_TOOLS = new Set(["read_file", "search", "list_dir", "web_fetch", "web_search"]);
const EMPTY_SET = new Set<string>();

const EXPLORER_SYSTEM_PROMPT = `You are a focused code explorer — a read-only sub-agent spawned to investigate ONE question and report back. Your only tools are read_file, search, list_dir, web_fetch, and web_search. You CANNOT edit files, run commands, or ask the user anything.

- Use search to locate code, list_dir to orient, read_file to read it for yourself; web_search + web_fetch when the question needs external/library docs. Follow the trail until you can answer.
- Be efficient — you have a limited step budget. Go straight for the answer, don't wander.
- When you have enough, STOP calling tools and write your findings.

Your FINAL message must be a concise, self-contained summary that answers the task: the key files with line references, how the relevant pieces fit together, and anything the parent agent needs to act. Prefer exact paths and symbol names over prose. Do not ask questions — give your best answer from what you found.`;

const hasContent = (m: Message): boolean => Boolean(m.content) || (m.tool_calls?.length ?? 0) > 0;

// Injected-dependency deps so the loop is PURE (no network/fs/stdout) → unit-testable with fakes,
// matching the resolveEdit / buildRequestBody test style.
export type ExploreDeps = {
  call: (messages: Message[], includeTools: boolean, signal?: AbortSignal) => Promise<Message>;
  dispatch: (call: ToolCall, signal?: AbortSignal) => Promise<string>;
  gate: (toolName: string, args: Record<string, any>) => { ok: true } | { ok: false; reason: string };
  onStep?: (name: string, args: Record<string, any>, result: string | null, blocked?: string) => void;
  maxSteps: number;
};

// The child agentic loop. Runs its own fresh conversation; returns the final findings text.
export async function exploreLoop(deps: ExploreDeps, task: string, focus: string | undefined, signal?: AbortSignal): Promise<string> {
  const messages: Message[] = [
    { role: "system", content: EXPLORER_SYSTEM_PROMPT },
    { role: "user", content: `Task: ${task}` + (focus ? `\n\nStart by looking at: ${focus}` : "") },
  ];

  for (let step = 0; step < deps.maxSteps && !signal?.aborted; step++) {
    const message = await deps.call(messages, true, signal);
    if (!hasContent(message)) break; // empty completion → give up, wrap up below
    messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) {
        if (signal?.aborted) break;
        let args: Record<string, any> = {};
        try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* dispatch reports bad JSON */ }
        const g = deps.gate(call.function.name, args);
        if (!g.ok) {
          messages.push({ role: "tool", tool_call_id: call.id, content: `Denied: ${g.reason}. You are a read-only explorer confined to the project — work with what you can read in-root.` });
          deps.onStep?.(call.function.name, args, null, g.reason);
          continue;
        }
        const result = await deps.dispatch(call, signal);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
        deps.onStep?.(call.function.name, args, result);
      }
    } else {
      return message.content ?? "(the explorer returned no findings)"; // text answer = the findings
    }
  }

  if (signal?.aborted) return "(exploration cancelled)";
  // Budget exhausted (or empty completion): one final no-tools call to force a summary.
  const wrap = await deps.call(
    [...messages, { role: "system", content: "Stop exploring now. Write your findings summary from what you've gathered so far; do not call any tools." }],
    false,
    signal,
  );
  return wrap.content ?? "(the explorer reached its step budget without a conclusion)";
}

// Dim, indented narration of a child step (transparent, attributed to the sub-agent).
function narrate(name: string, args: Record<string, any>, result: string | null, blocked?: string): void {
  const arg =
    name === "read_file" || name === "list_dir" ? String(args.path ?? "")
    : name === "search" ? String(args.pattern ?? "")
    : name === "web_fetch" ? String(args.url ?? "")
    : name === "web_search" ? String(args.query ?? "")
    : "";
  if (blocked) { console.log(color.dim(`      ${name} ${stripControl(arg)} — denied`)); return; }
  const lines = result ? result.split("\n").length : 0;
  console.log(color.dim(`      ${name} ${stripControl(arg)}${lines ? ` · ${lines} lines` : ""}`));
}

// IO shell: build the restricted tool set + deps and run the loop. Called by the `explore` tool.
// Deps are built LAZILY here (not at module top) so the tools↔subagent↔agent ESM cycle is safe.
export async function runExplorer(task: string, focus: string | undefined, signal?: AbortSignal): Promise<string> {
  const defs = toolDefs.filter((t) => EXPLORER_TOOLS.has(t.name));
  const childSchema = defs.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const childByName = new Map<string, ToolDef>(defs.map((t) => [t.name, t]));
  const cap = config.maxToolResultChars;

  const deps: ExploreDeps = {
    call: (m, incl, sig) => callModel(m, incl, sig, { tools: childSchema, quiet: true }),
    dispatch: async (c, sig) => {
      const r = await runTool(c, sig, childByName); // restricted map = the allow-list
      return r.length > cap ? r.slice(0, cap) + `\n…[truncated ${r.length - cap} chars]` : r;
    },
    gate: (name, args) => {
      const d = decideApproval(childByName.get(name), args, { mode: "readonly", autoApprove: true, approvedTools: EMPTY_SET, toolName: name });
      return d.action === "run" ? { ok: true } : { ok: false, reason: d.reason ?? "not allowed for the read-only explorer" };
    },
    onStep: narrate,
    maxSteps: config.subAgentMaxSteps,
  };

  try {
    console.log(color.dim(`  ↳ exploring: ${stripControl(task)}`));
    const findings = await exploreLoop(deps, task, focus, signal);
    console.log(color.dim(`  ↳ findings ready`));
    return findings;
  } catch (err) {
    if (signal?.aborted || (err as Error)?.name === "AbortError") return "(exploration cancelled)";
    return `Error exploring: ${(err as Error).message}`;
  }
}
