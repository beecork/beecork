// Context management: keep the conversation within the model's window by
// estimating its size and, when too big, summarizing the older messages.

import { API_KEY, config } from "./config";
import { state } from "./state";
import { color } from "./ui";
import type { Message } from "./types";

// Rough token estimate: ~4 characters per token. Good enough to decide WHEN to
// compact (a precise count needs a model-specific tokenizer + a dependency).
export function estimateTokens(messages: Message[]): number {
  const text = messages.map((m) => (m.content ?? "") + (m.tool_calls ? JSON.stringify(m.tool_calls) : "")).join("");
  return Math.ceil(text.length / 4);
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

// Ask the model to compress a chunk of conversation into notes.
async function summarize(old: Message[]): Promise<string> {
  const res = await fetch(config.apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: state.model,
      messages: [
        {
          role: "system",
          content:
            "You compress conversations. Summarize the transcript into concise notes that preserve key facts, decisions, file contents discovered, and the user's goals, so the assistant can continue seamlessly.",
        },
        { role: "user", content: transcript(old) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`summary failed: ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content ?? "(summary unavailable)";
}

// If the conversation is too big, replace the OLD middle with a summary, keeping
// the system prompt and the most recent messages.
// Where to cut the conversation: keep the last `keepRecent` messages, but snap
// the boundary back to a USER message so we never split an assistant→tool group
// (which would be invalid). Pure + exported so it can be unit-tested.
export function compactionStart(messages: Message[], keepRecent: number): number {
  let start = Math.max(1, messages.length - keepRecent);
  while (start > 1 && messages[start].role !== "user") start--;
  return start;
}

export async function compactIfNeeded(messages: Message[]): Promise<Message[]> {
  if (estimateTokens(messages) <= config.maxContextTokens) return messages;

  const start = compactionStart(messages, config.keepRecent);
  if (start <= 1) return messages; // nothing old enough to summarize

  const system = messages[0];
  const old = messages.slice(1, start);
  const recent = messages.slice(start);

  console.log(color.dim(`\n[context full — compacting ${old.length} older messages into a summary…]`));
  const summary = await summarize(old);

  return [system, { role: "system", content: `Summary of earlier conversation:\n${summary}` }, ...recent];
}
