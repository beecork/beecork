// Context management: keep the conversation within the model's window by
// estimating its size and, when too big, summarizing the older messages.

import { config } from "./config";
import { state } from "./state";
import { color } from "./ui";
import { openRouterChat, sleep, isTransientStatus } from "./api";
import type { Message } from "./types";

// Rough token estimate: ~4 characters per token. Good enough to decide WHEN to
// compact (a precise count needs a model-specific tokenizer + a dependency).
// Sum lengths directly — don't build the whole transcript string just to measure it.
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) chars += (m.content?.length ?? 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0);
  return Math.ceil(chars / 4);
}

// Flatten messages into a plain transcript. We summarize TEXT (not structured
// messages) to sidestep tool-call pairing rules.
export function transcript(messages: Message[]): string {
  return messages
    .map((m) => {
      if (m.role === "tool") return `[tool result] ${m.content ?? ""}`;
      if (m.tool_calls?.length) {
        return `assistant called: ${m.tool_calls.map((t) => `${t.function.name}(${t.function.arguments})`).join(", ")}`;
      }
      return `${m.role}: ${m.content ?? ""}`;
    })
    .join("\n");
}

// Ask the model to compress a chunk of conversation into notes. Resilient like
// callModel: retry transient failures, honor the turn's abort signal + a timeout,
// and parse the response defensively (a 200 with {error} or no choices must not throw
// a cryptic TypeError).
async function summarize(old: Message[], signal?: AbortSignal): Promise<string> {
  const body = {
    model: state.model,
    messages: [
      {
        role: "system",
        content:
          "You compress conversations. Summarize the transcript into concise notes that preserve key facts, decisions, file contents discovered, and the user's goals, so the assistant can continue seamlessly.",
      },
      { role: "user", content: transcript(old) },
    ],
  };
  const tries = config.retryAttempts;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const timeout = AbortSignal.timeout(30_000);
    const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await openRouterChat(body, sig);
      if (!res.ok) {
        if (isTransientStatus(res.status) && attempt < tries) {
          await sleep(500 * attempt);
          continue;
        }
        throw new Error(`summary failed: HTTP ${res.status}`);
      }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text) return text;
      throw new Error(data?.error ? `summary error: ${JSON.stringify(data.error)}` : "summary returned no content");
    } catch (err) {
      if (signal?.aborted || attempt >= tries) throw err;
      await sleep(500 * attempt);
    }
  }
  throw new Error("summary failed after retries");
}

// If the conversation is too big, replace the OLD middle with a summary, keeping
// the system prompt and the most recent messages.
// Where to cut the conversation: keep the last `keepRecent` messages, but snap
// the boundary back to a USER message so we never split an assistant→tool group
// (which would be invalid). Pure + exported so it can be unit-tested.
export function compactionStart(messages: Message[], keepRecent: number): number {
  // Clamp to a valid index — keepRecent=0 would otherwise read messages[length] (OOB).
  let start = Math.min(messages.length - 1, Math.max(1, messages.length - keepRecent));
  while (start > 1 && messages[start].role !== "user") start--;
  return start;
}

export async function compactIfNeeded(messages: Message[], signal?: AbortSignal): Promise<Message[]> {
  if (estimateTokens(messages) <= config.maxContextTokens) return messages;

  const start = compactionStart(messages, config.keepRecent);
  if (start <= 1) return messages; // nothing old enough to summarize

  const system = messages[0];
  const old = messages.slice(1, start);
  const recent = messages.slice(start);

  console.log(color.dim(`\n[context full — compacting ${old.length} older messages into a summary…]`));
  try {
    const summary = await summarize(old, signal);
    return [system, { role: "system", content: `Summary of earlier conversation:\n${summary}` }, ...recent];
  } catch (err) {
    // Summarizing failed (network/abort/malformed). Rather than proceed with an
    // over-budget request, HARD-TRIM: drop the old middle, keep system + recent.
    console.error(color.red(`[compaction failed: ${(err as Error).message} — hard-trimming instead]`) + "\n");
    return [system, { role: "system", content: "(Earlier conversation was trimmed to fit the context window.)" }, ...recent];
  }
}
