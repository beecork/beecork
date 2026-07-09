// Talking to the model: one streaming call. Prints text deltas live, reassembles
// tool-call deltas, and retries transient failures. "Transient" includes an EMPTY
// completion — a stream that ends with no content and no tool calls. That happens
// with reasoning models (e.g. glm via some providers) whose stream occasionally
// truncates after the hidden `reasoning` phase, before the real answer arrives.
// HTTP 200 hides it, so without this retry the agentic loop silently no-ops the
// whole turn. We salvage a usable partial text reply rather than retrying it.

import { config } from "./config";
import type { ReasoningEffort } from "./config";
import { state } from "./state";
import { shouldSendReasoning } from "./capabilities";
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

// One parsed SSE "data:" line. The PURE parse step (JSON + classify) is split out from the
// stateful application in callModel's handleLine so it can be unit-tested over fixtures.
// Returns null for lines to ignore (non-data, [DONE], unparseable, empty delta).
export type ParsedSSE = { content?: string; toolCalls?: any[]; reasoning?: string; reasoningDetails?: any[]; error?: string; errorCode?: number };
export function parseSSELine(line: string): ParsedSSE | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return null;
  let parsed: any;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed.error) {
    // OpenRouter can stream an error object (rate limit, context length, content filter)
    // instead of choices — surface it rather than swallowing it as an empty completion.
    const error = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || JSON.stringify(parsed.error);
    const rawCode = typeof parsed.error === "object" ? (parsed.error?.code ?? parsed.error?.status) : undefined;
    return { error, errorCode: rawCode != null ? Number(rawCode) : undefined };
  }
  const delta = parsed.choices?.[0]?.delta;
  if (!delta) return null;
  const out: ParsedSSE = {};
  if (delta.content) out.content = delta.content;
  if (delta.tool_calls) out.toolCalls = delta.tool_calls;
  // Reasoning ("thinking") streams alongside the answer: `reasoning` is the plaintext, and/or
  // `reasoning_details` the structured blocks (which carry provider signatures for replay).
  if (typeof delta.reasoning === "string" && delta.reasoning) out.reasoning = delta.reasoning;
  if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length) out.reasoningDetails = delta.reasoning_details;
  return out; // may be {} for a delta with neither — handled as a no-op
}

// Build the chat-completions request body. PURE (no IO) so the reasoning/escape-hatch wiring
// can be unit-tested. `extra` (OPENROUTER_EXTRA) is merged FIRST so power-users can tune sampling
// or even override `reasoning`, but the STRUCTURAL fields (model/messages/stream/tools) always win
// so a bad escape-hatch value can't break the request shape.
export function buildRequestBody(opts: {
  model: string;
  messages: Message[];
  includeTools: boolean;
  effort: ReasoningEffort;
  reasoningSupported: boolean;
  extra: Record<string, unknown>;
  tools?: object[]; // override the tool schema (a sub-agent sends a RESTRICTED set); omit → the global TOOLS
}): Record<string, unknown> {
  const { model, messages, includeTools, effort, reasoningSupported, extra, tools } = opts;
  const body: Record<string, unknown> = { ...extra };
  body.model = model;
  body.messages = messages;
  body.stream = true;
  if (includeTools) body.tools = tools ?? TOOLS;
  // Only send `reasoning` when the model supports it (else it may 400) AND the user didn't already
  // pin their own reasoning via the escape hatch. "off" actively disables thinking (even on models
  // that default it on, like deepseek); a level sets the depth via the unified `effort` field.
  if (reasoningSupported && !("reasoning" in extra)) {
    body.reasoning = effort === "off" ? { enabled: false } : { effort };
  }
  return body;
}

// Reasoning only needs to travel with the CURRENT turn's trailing tool-call chain (some providers,
// e.g. Anthropic, require the thinking block resent alongside the tool_calls it produced). Older
// turns' reasoning is dead weight — resending it every turn costs real tokens for nothing. So strip
// reasoning from every message up to and including the last user message; keep it only after.
// PURE — returns a shallow copy; the stored history keeps its reasoning intact.
export function pruneReasoningForSend(messages: Message[]): Message[] {
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { lastUser = i; break; }
  }
  return messages.map((m, i) => {
    if (i > lastUser || (m.reasoning === undefined && m.reasoning_details === undefined)) return m;
    const { reasoning, reasoning_details, ...rest } = m;
    return rest;
  });
}

// `opts.tools` overrides the tool schema (sub-agent restricted set); `opts.quiet` suppresses all
// DISPLAY (spinner + streamed thinking/answer) while keeping accumulation intact — used when a child
// agent runs, so its internal monologue doesn't print as the top-level `bee`. Defaults reproduce the
// parent path byte-for-byte.
export async function callModel(
  messages: Message[],
  includeTools = true,
  signal?: AbortSignal,
  opts?: { tools?: object[]; quiet?: boolean },
): Promise<Message> {
  const quiet = opts?.quiet ?? false;
  const body = buildRequestBody({
    model: state.model,
    messages: pruneReasoningForSend(messages),
    includeTools,
    effort: state.reasoningEffort,
    reasoningSupported: shouldSendReasoning(state.model),
    extra: config.openRouterExtra,
    tools: opts?.tools,
  });

  const tries = config.retryAttempts;
  // One attempt = fetch + stream. Retry on a network error, a 429/5xx, OR an
  // empty/truncated completion. Permanent errors (bad key/model = 4xx) throw.
  for (let attempt = 1; attempt <= tries; attempt++) {
    // Per-attempt timeout so a stalled connection/stream can't hang the turn forever
    // (esp. headless, where there's no one to Ctrl-C). A timeout is transient → retried;
    // only the user's own signal counts as a cancel.
    const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(config.apiTimeoutMs)]) : AbortSignal.timeout(config.apiTimeoutMs);
    // Start spinning BEFORE the request — so there's instant feedback during connect +
    // time-to-first-byte (often 1-2s), not a dead pause until the response lands. (Quiet child: no UI.)
    const stopSpinner = quiet ? () => {} : startSpinner("thinking…");
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
    let reasoning = ""; // plaintext thinking (delta.reasoning), for display + replay
    const reasoningDetails: any[] = []; // structured thinking blocks, reassembled by index for verbatim replay
    let printedReasoning = false;
    let printedText = false;
    let streamBroke = false;
    let streamError: string | null = null; // a mid-stream {error:…} event (don't treat it as "empty") // died mid-way with nothing usable → treat as transient
    let streamErrorCode: number | undefined; // its numeric code/status, for the transient-vs-permanent decision
    const decoder = new TextDecoder();
    let buffer = "";

    // Render the model's markdown to ANSI as it streams (TTY only — eval/piped runs
    // keep the raw char-stream so their output is unchanged). `content` below still
    // accumulates the RAW markdown for history; this only changes what the human sees.
    const md = process.stdout.isTTY && !quiet ? createMarkdownStream((s) => process.stdout.write(s)) : null;

    // (The spinner is already running — started before the request above — and is
    // stopped the moment the first token or tool call lands.)

    // Stream the model's thinking DIMLY, distinct from the answer — TTY only, so it never
    // pollutes piped/eval output (which must stay stable). Accumulation happens regardless.
    const displayThinking = (s: string) => {
      if (quiet || !process.stdout.isTTY || !s) return;
      stopSpinner();
      if (!printedReasoning) { process.stdout.write("\n" + color.dim("thinking: ")); printedReasoning = true; }
      process.stdout.write(color.dim(stripControl(s)));
    };
    // Reassemble a streamed reasoning_details block by index (same pattern as tool_calls):
    // text/summary/data are chunked → concatenate; type/format/id/signature arrive whole → assign
    // verbatim (the signature MUST stay byte-exact or providers like Anthropic reject the replay).
    const mergeDetail = (d: any) => {
      const i = typeof d.index === "number" ? d.index : reasoningDetails.length ? reasoningDetails.length - 1 : 0;
      const slot = (reasoningDetails[i] ??= {});
      if (d.type) slot.type = d.type;
      if (d.format) slot.format = d.format;
      if (d.id) slot.id = d.id;
      if (d.signature) slot.signature = d.signature;
      if (typeof d.index === "number") slot.index = d.index;
      if (typeof d.text === "string") slot.text = (slot.text ?? "") + d.text;
      if (typeof d.summary === "string") slot.summary = (slot.summary ?? "") + d.summary;
      if (typeof d.data === "string") slot.data = (slot.data ?? "") + d.data;
    };

    // Apply one SSE "data:" line to the accumulating stream state. The parse is done by the pure
    // parseSSELine (tested separately); this handles a final line sent WITHOUT a trailing newline
    // (some providers/proxies) by being callable on the leftover buffer after the loop.
    const handleLine = (line: string) => {
      const ev = parseSSELine(line);
      if (!ev) return;
      if (ev.error !== undefined) {
        streamError = ev.error;
        streamErrorCode = ev.errorCode;
        return;
      }
      if (ev.reasoning) {
        reasoning += ev.reasoning;
        displayThinking(ev.reasoning);
      }
      if (ev.reasoningDetails) {
        for (const d of ev.reasoningDetails) {
          mergeDetail(d);
          // If the provider sends ONLY structured details (no flat `reasoning`), still show its text.
          if (!ev.reasoning) displayThinking(typeof d.text === "string" ? d.text : typeof d.summary === "string" ? d.summary : "");
        }
      }
      if (ev.content) {
        stopSpinner();
        if (!quiet) {
          if (!printedText) {
            process.stdout.write("\n" + color.cyan("bee: "));
            printedText = true;
          }
          // stripControl: the model's text must not carry raw escape sequences to the terminal
          // (the markdown renderer adds its OWN ANSI afterward, on the cleaned text).
          const safe = stripControl(ev.content);
          if (md) md.push(safe);
          else process.stdout.write(safe);
        }
        content += ev.content; // history keeps the RAW markdown (display suppressed for a quiet child)
      }
      if (ev.toolCalls) {
        stopSpinner();
        for (const tc of ev.toolCalls) {
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
    } else if (printedReasoning) {
      process.stdout.write("\n"); // close the dim "thinking:" line when there's no answer text after it
    }

    // A mid-stream error event is a real API failure (not a do-nothing turn). A TRANSIENT one
    // (rate limit / 5xx / overloaded) retries with backoff like the HTTP-status path above,
    // rather than failing the whole turn; a permanent error (bad key, content filter) still throws.
    if (streamError) {
      const transient = (streamErrorCode !== undefined && Number.isFinite(streamErrorCode) && isTransientStatus(streamErrorCode)) ||
        /rate.?limit|overloaded|temporar|timeout|try again|\b(429|500|502|503|504)\b/i.test(streamError);
      if (transient && attempt < tries) {
        console.log(color.dim(`   (stream error — retry ${attempt}/${tries - 1})`));
        await sleep(500 * attempt);
        continue;
      }
      throw new Error(`OpenRouter stream error: ${streamError}`);
    }

    // Retry an empty completion (no content, no tool calls) or a broken stream —
    // the truncated-reasoning case that would otherwise no-op the whole turn.
    const empty = !content && toolCalls.length === 0;
    if ((empty || streamBroke) && attempt < tries) {
      console.log(color.dim(`   (empty response — retry ${attempt}/${tries - 1})`));
      await sleep(500 * attempt);
      continue;
    }

    const message: Message = { role: "assistant", content: content || null };
    // Drop array holes from a sparse tc.index; synthesize an id when a provider omits one, so the
    // assistant tool_call and its tool result don't both carry "" (collisions / provider rejects).
    const calls = toolCalls.filter(Boolean).map((c, i) => (c.id ? c : { ...c, id: `call_${i}` }));
    if (calls.length > 0) message.tool_calls = calls;
    // Keep the thinking on the message so it can be replayed for THIS turn's tool chain (required
    // by some providers). pruneReasoningForSend drops it once the turn is behind us.
    if (reasoning) message.reasoning = reasoning;
    const details = reasoningDetails.filter(Boolean);
    if (details.length > 0) message.reasoning_details = details;
    return message;
  }

  // Exhausted all attempts still empty. runTurn detects this do-nothing turn,
  // surfaces a notice, and does not persist the null message.
  return { role: "assistant", content: null };
}
