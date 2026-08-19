// A SCRIPTED MODEL for deterministic whole-agent tests.
//
// beecork's only network boundary is the bare `fetch` inside openRouterChat (api.ts), so a whole-agent
// test needs no production seam at all: swap `globalThis.fetch`, hand back a canned SSE stream, and the
// REAL runTurn / tool registry / approval gate / session code runs unchanged. That is the point — a
// mock at the loop level would prove nothing about the loop.
//
// Test-only. Nothing in src/index.ts imports it, so it never reaches the bundle.

import { config } from "./config";

// One scripted model response. The union mirrors the four ways a real turn can go.
export type ScriptStep =
  | {
      // A normal completion. `tools` become tool_call deltas; `text` becomes content deltas.
      text?: string;
      tools?: { id: string; name: string; args: unknown }[];
      reasoning?: string;
    }
  | { httpError: number; body?: string } // non-2xx response (429/5xx retry, 4xx throws)
  | { networkError: string } // fetch itself rejects (DNS/socket)
  | { streamError: string; code?: number }; // a mid-stream {"error":…} event

export type ScriptedModel = {
  restore(): void;
  /** Request bodies the agent actually sent, in order — assert on what the model was shown. */
  requests: { model?: string; messages?: unknown[]; tools?: unknown[] }[];
  /** How many script steps were consumed (a turn that stops early leaves some unused). */
  consumed(): number;
};

const enc = new TextEncoder();

// Build the SSE byte stream for one completion. Deliberately chunked mid-token and mid-arguments:
// a provider splits tool-call arguments across deltas, and callModel's reassembly must survive it.
function sseBody(step: Extract<ScriptStep, { text?: string }>): AsyncIterable<Uint8Array> {
  const lines: string[] = [];
  const push = (obj: unknown) => lines.push(`data: ${JSON.stringify(obj)}\n`);

  if (step.reasoning) push({ choices: [{ delta: { reasoning: step.reasoning } }] });

  for (const [i, t] of (step.tools ?? []).entries()) {
    const args = typeof t.args === "string" ? t.args : JSON.stringify(t.args ?? {});
    // id + name first, then arguments split in two — the shape real providers stream.
    push({ choices: [{ delta: { tool_calls: [{ index: i, id: t.id, function: { name: t.name, arguments: "" } }] } }] });
    const cut = Math.floor(args.length / 2);
    push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: args.slice(0, cut) } }] } }] });
    push({ choices: [{ delta: { tool_calls: [{ index: i, function: { arguments: args.slice(cut) } }] } }] });
  }

  if (step.text) {
    for (const piece of step.text.match(/.{1,7}/gs) ?? []) push({ choices: [{ delta: { content: piece } }] });
  }
  lines.push("data: [DONE]\n");

  return {
    async *[Symbol.asyncIterator]() {
      for (const l of lines) yield enc.encode(l + "\n");
    },
  };
}

function errorBody(message: string, code?: number): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield enc.encode(`data: ${JSON.stringify({ error: { message, code } })}\n\n`);
      yield enc.encode("data: [DONE]\n\n");
    },
  };
}

/**
 * Install a scripted model. Every call to the chat endpoint consumes the next step; running past the
 * end throws (a test that loops more than it scripted is a bug in the test OR the loop, and silence
 * would hide both). The model catalog is stubbed empty so capabilities.ts fails open without network.
 */
export function installScriptedModel(
  steps: ScriptStep[],
  opts: { onRequest?: (callIndex: number) => void; summary?: string } = {},
): ScriptedModel {
  const realFetch = globalThis.fetch;
  const requests: ScriptedModel["requests"] = [];
  let i = 0;

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);

    // capabilities.ts / commands.ts fetch the OpenRouter catalog. Answer it locally so tests never
    // touch the network and never fail open/closed by accident of timing.
    if (url === config.modelsUrl) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (url !== config.apiUrl) throw new Error(`scripted model: unexpected fetch to ${url}`);

    let parsed: any = {};
    try {
      parsed = JSON.parse(String(init?.body ?? "{}"));
    } catch {
      /* leave {} */
    }

    // Compaction's summarize() is the one NON-streaming call on the same endpoint. Serve it from its
    // own canned answer and do NOT consume a script step — otherwise every test that happens to
    // compact would have to script an invisible extra "model call" it never asked about.
    if (parsed.stream !== true) {
      const content = opts.summary ?? "Rules: none\nGoal: test\nDone: earlier work\nFacts: none\nErrors & fixes: none\nPending: none";
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    requests.push(parsed);

    // Fires BEFORE the response is built, so a test can abort mid-turn at an exact model call —
    // the deterministic stand-in for the user hitting Ctrl-C at that moment.
    opts.onRequest?.(i);

    const step = steps[i++];
    if (!step) throw new Error(`scripted model: ran out of steps (the agent made ${i} model calls, ${steps.length} scripted)`);

    if ("networkError" in step) throw new Error(step.networkError);
    if ("httpError" in step) {
      return new Response(step.body ?? `{"error":"scripted ${step.httpError}"}`, { status: step.httpError });
    }
    const body = "streamError" in step ? errorBody(step.streamError, step.code) : sseBody(step);
    // Not a real Response: callModel only reads .ok/.status/.text()/.body, and a hand-rolled
    // async-iterable body keeps the chunk boundaries under the test's control.
    return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
  }) as typeof fetch;

  return {
    restore() {
      globalThis.fetch = realFetch;
    },
    requests,
    consumed: () => i,
  };
}
