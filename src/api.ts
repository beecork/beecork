// Talking to the model: one streaming call. Prints text deltas live, reassembles
// tool-call deltas, and retries transient failures. "Transient" includes an EMPTY
// completion — a stream that ends with no content and no tool calls. That happens
// with reasoning models (e.g. glm via some providers) whose stream occasionally
// truncates after the hidden `reasoning` phase, before the real answer arrives.
// HTTP 200 hides it, so without this retry the agentic loop silently no-ops the
// whole turn. We salvage a usable partial text reply rather than retrying it.

import { config } from "./config";
import { state } from "./state";
import { color, startSpinner, stripControl } from "./ui";
import { createMarkdownStream } from "./markdown";
import { TOOLS } from "./tools";
import type { Message, ToolCall } from "./types";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// HTTP statuses worth retrying with backoff (rate limit + server errors). Shared with context.ts.
export const isTransientStatus = (status: number) => status === 429 || status >= 500;

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
    // Per-attempt timeout so a stalled connection/stream can't hang the turn forever
    // (esp. headless, where there's no one to Ctrl-C). A timeout is transient → retried;
    // only the user's own signal counts as a cancel.
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.apiTimeoutMs)]) : AbortSignal.timeout(config.apiTimeoutMs);
    // Start spinning BEFORE the request — so there's instant feedback during connect +
    // time-to-first-byte (often 1-2s), not a dead pause until the response lands.
    const stopSpinner = startSpinner("thinking…");
    let response: Response;
    try {
      response = await openRouterChat(body, sig);
    } catch (err) {
      stopSpinner();
      if (signal?.aborted) throw err; // user cancelled (Ctrl-C) — don't retry
      if (attempt >= tries) throw err;
      console.log(color.dim(`   (network error/timeout — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }
    if (!response.ok) {
      stopSpinner();
      if (isTransientStatus(response.status) && attempt < tries) {
        console.log(color.dim(`   (HTTP ${response.status} — retry ${attempt}/${tries - 1})`));
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`OpenRouter error ${response.status}: ${await response.text()}`);
    }
    if (!response.body) { stopSpinner(); throw new Error("No response body to stream."); }

    let content = "";
    const toolCalls: ToolCall[] = [];
    let printedText = false;
    let streamBroke = false;
    let streamError: string | null = null; // a mid-stream {error:…} event (don't treat it as "empty") // died mid-way with nothing usable → treat as transient
    const decoder = new TextDecoder();
    let buffer = "";

    // Render the model's markdown to ANSI as it streams (TTY only — eval/piped runs
    // keep the raw char-stream so their output is unchanged). `content` below still
    // accumulates the RAW markdown for history; this only changes what the human sees.
    const md = process.stdout.isTTY ? createMarkdownStream((s) => process.stdout.write(s)) : null;

    // (The spinner is already running — started before the request above — and is
    // stopped the moment the first token or tool call lands.)

    // Process one SSE "data:" line. Extracted so a final line sent WITHOUT a trailing
    // newline (some providers/proxies) can be flushed after the loop instead of dropped.
    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      if (parsed.error) {
        // OpenRouter can stream an error object (rate limit, context length, content filter)
        // instead of choices — surface it rather than swallowing it as an empty completion.
        streamError = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || JSON.stringify(parsed.error);
        return;
      }
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        stopSpinner();
        if (!printedText) {
          process.stdout.write("\n" + color.cyan("bee: "));
          printedText = true;
        }
        // stripControl: the model's text must not carry raw escape sequences to the terminal
        // (the markdown renderer adds its OWN ANSI afterward, on the cleaned text).
        const safe = stripControl(delta.content);
        if (md) md.push(safe);
        else process.stdout.write(safe);
        content += delta.content; // history keeps the RAW markdown
      }
      if (delta.tool_calls) {
        stopSpinner();
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          toolCalls[i] ??= { id: "", type: "function", function: { name: "", arguments: "" } };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].function.name = tc.function.name;
          if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
        }
      }
    };

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
      }
      if (buffer.trim()) handleLine(buffer); // flush a final data: line with no trailing newline
    } catch (err) {
      stopSpinner();
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
    stopSpinner(); // ensure stopped before any further output (idempotent)

    if (printedText) {
      if (md) { md.end(); process.stdout.write("\n"); } // flush the last buffered line
      else process.stdout.write("\n\n");
    }

    // A mid-stream error event is a real API failure (not a do-nothing turn) — surface it.
    if (streamError) throw new Error(`OpenRouter stream error: ${streamError}`);

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
