// Talking to the model: one streaming call. Prints text deltas live, reassembles
// tool-call deltas, and retries transient failures. "Transient" includes an EMPTY
// completion — a stream that ends with no content and no tool calls. That happens
// with reasoning models (e.g. glm via some providers) whose stream occasionally
// truncates after the hidden `reasoning` phase, before the real answer arrives.
// HTTP 200 hides it, so without this retry the agentic loop silently no-ops the
// whole turn. We salvage a usable partial text reply rather than retrying it.

import { config } from "./config";
import { state } from "./state";
import { color } from "./ui";
import { TOOLS } from "./tools";
import type { Message, ToolCall } from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One POST to the OpenRouter chat-completions endpoint — the single place that owns
// the URL + auth header, shared by the streaming callModel and the non-streaming
// summarize() so the two can't drift apart.
export function openRouterChat(body: object, signal?: AbortSignal): Promise<Response> {
  return fetch(config.apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function callModel(messages: Message[], includeTools = true, signal?: AbortSignal): Promise<Message> {
  const body = {
    model: state.model,
    messages,
    ...(includeTools ? { tools: TOOLS } : {}),
    stream: true,
  };

  const tries = config.retryAttempts;
  // One attempt = fetch + stream. Retry on a network error, a 429/5xx, OR an
  // empty/truncated completion. Permanent errors (bad key/model = 4xx) throw.
  for (let attempt = 1; attempt <= tries; attempt++) {
    let response: Response;
    try {
      response = await openRouterChat(body, signal);
    } catch (err) {
      if (signal?.aborted) throw err; // user cancelled (Ctrl-C) — don't retry
      if (attempt >= tries) throw err;
      console.log(color.dim(`   (network error — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < tries) {
        console.log(color.dim(`   (HTTP ${response.status} — retry ${attempt}/${tries - 1})`));
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
    }
    if (!response.body) throw new Error("No response body to stream.");

    let content = "";
    const toolCalls: ToolCall[] = [];
    let printedText = false;
    let streamBroke = false; // died mid-way with nothing usable → treat as transient
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;

          let parsed: any;
          try {
            parsed = JSON.parse(payload);
          } catch {
            continue;
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            if (!printedText) {
              process.stdout.write("\n" + color.cyan("bot: "));
              printedText = true;
            }
            process.stdout.write(delta.content);
            content += delta.content;
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? 0;
              toolCalls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
              if (tc.id) toolCalls[i].id = tc.id;
              if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
              if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
            }
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) throw err; // user cancelled (Ctrl-C) — don't salvage/retry
      // Stream died mid-way. A plain-text answer with no half-built tool call is
      // usable — salvage it. Otherwise treat as transient and retry below.
      if (content && toolCalls.length === 0) {
        console.log(color.dim(`\n   (stream interrupted — using partial reply)`));
      } else {
        if (attempt >= tries) throw err;
        streamBroke = true;
      }
    }

    if (printedText) process.stdout.write("\n\n");

    // Retry an empty completion (no content, no tool calls) or a broken stream —
    // the truncated-reasoning case that would otherwise no-op the whole turn.
    const empty = !content && toolCalls.length === 0;
    if ((empty || streamBroke) && attempt < tries) {
      console.log(color.dim(`   (empty response — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }

    const message: Message = { role: "assistant", content: content || null };
    const calls = toolCalls.filter(Boolean); // drop array holes from a sparse tc.index
    if (calls.length > 0) message.tool_calls = calls;
    return message;
  }

  // Exhausted all attempts still empty. runTurn detects this do-nothing turn,
  // surfaces a notice, and does not persist the null message.
  return { role: "assistant", content: null };
}
