// Talking to the model: one streaming call. Prints text deltas live, reassembles
// tool-call deltas, retries transient failures, and salvages a partial reply if
// the stream dies after we've already received a text answer.

import { API_KEY, config } from "./config";
import { state } from "./state";
import { color } from "./ui";
import { TOOLS } from "./tools";
import type { Message, ToolCall } from "./types";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function callModel(messages: Message[], includeTools = true): Promise<Message> {
  const body = JSON.stringify({
    model: state.model,
    messages,
    ...(includeTools ? { tools: TOOLS } : {}),
    stream: true,
  });

  // Retry transient failures (network error, 429, 5xx) before streaming starts.
  // Permanent errors (bad key/model = 4xx) throw immediately.
  let response: Response | undefined;
  const tries = config.retryAttempts;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      response = await fetch(config.apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      if (attempt >= tries) throw err;
      console.log(color.dim(`   (network error — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }
    if (response.ok) break;
    if ((response.status === 429 || response.status >= 500) && attempt < tries) {
      console.log(color.dim(`   (HTTP ${response.status} — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }
    throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
  }

  if (!response || !response.body) throw new Error("No response body to stream.");

  let content = "";
  const toolCalls: ToolCall[] = [];
  let printedText = false;
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
    // Stream died mid-way. If we already have a plain-text answer (and no
    // half-built tool call), salvage it instead of losing the whole turn.
    if (!(content && toolCalls.length === 0)) throw err;
    console.log(color.dim(`\n   (stream interrupted — using partial reply)`));
  }

  if (printedText) process.stdout.write("\n\n");

  const message: Message = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}
