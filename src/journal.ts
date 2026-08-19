// THE EXECUTION JOURNAL — an append-only record of what actually happened.
//
// The conversation array answers "what should we send the model next?". That is a different question
// from "what did this agent actually do?", and beecork used to make one array answer both. When they
// conflicted, the API payload won and the record was destroyed — a tool call that really edited a
// file could vanish from history because a LATER request failed.
//
// runTurn no longer throws work away (see sealInterruptedToolCalls), so the transcript is honest
// again. This file covers what a transcript still cannot say:
//   - a turn that was cancelled, errored, or hit the step limit — as DATA, not as a missing message
//   - approvals: what was asked, and what the user answered
//   - failure CODES, timings, and compaction events
//   - anything at all after a hard kill: the session file is written once, at exit, so a SIGKILL
//     loses the whole conversation. The journal is flushed at tool boundaries, so it survives.
//
// Deliberately NOT the source of truth for messages. Deriving the transcript from events would mean
// reproducing every provider-pairing rule beecork has learned (reasoning replay, image flushing,
// attachment messages, compaction cut points) for no user-visible gain — see
// .claude/think-it-through/from-deepseek-harness-review.md. This is a record, and records are cheap.
//
// It stores SUMMARIES, never full tool output: the journal is for answering "what happened", and
// duplicating file contents already in the session file would cost disk for nothing.

import { appendFile, mkdir, chmod, readdir, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import type { ToolCall, ToolOutcome, ToolFailureCode } from "./types";

export type TurnStatus = "completed" | "cancelled" | "error" | "step_limit" | "empty";

export type AgentEvent =
  | { type: "session_started"; model: string; cwd: string }
  | { type: "turn_started"; turnId: string; input: string }
  | { type: "steering_added"; turnId: string; note: string }
  | { type: "step_started"; turnId: string; step: number }
  | { type: "assistant_message"; turnId: string; step: number; text: string; calls: { id: string; name: string }[] }
  | { type: "tool_started"; turnId: string; step: number; callId: string; name: string; args: string }
  | { type: "approval_resolved"; callId: string; name: string; decision: "run" | "once" | "always" | "deny" | "auto" }
  | { type: "tool_finished"; callId: string; name: string; ok: boolean; code?: ToolFailureCode; ms: number; summary: string }
  | { type: "compaction_applied"; reason: "pressure" | "manual" | "context_overflow"; before: number; after: number }
  | { type: "turn_finished"; turnId: string; status: TurnStatus; steps: number; error?: string };

// One row as written: the event plus the envelope that makes a stream of them replayable.
type JournalRow = AgentEvent & { v: 1; seq: number; time: string };

const BEECORK = ".beecork";
const journalDir = () => join(process.cwd(), BEECORK, "journal");

let seq = 0;
let file: string | null = null;
let pending: string[] = [];
let writing: Promise<void> = Promise.resolve();
let disabled = false;

// Truncate anything model- or tool-supplied before it reaches disk. A journal row is a fact about
// execution, not a copy of the payload — and an unbounded row would let one giant tool result turn
// the record into the thing it is supposed to summarize.
const brief = (s: unknown, max = 300): string => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + `…[+${t.length - max}]` : t;
};

/** Summarize an outcome for the record: did it work, how did it fail, and roughly what came back. */
export function outcomeSummary(o: ToolOutcome): { ok: boolean; code?: ToolFailureCode; summary: string } {
  return o.ok
    ? { ok: true, summary: brief(o.text, 200) + (o.images.length ? ` [+${o.images.length} image(s)]` : "") }
    : { ok: false, code: o.code, summary: brief(o.text, 200) };
}

/** Compact description of one call, for tool_started. */
export const callFacts = (c: ToolCall) => ({ callId: c.id, name: c.function.name, args: brief(c.function.arguments, 400) });

/**
 * Open a journal for this session. Best-effort and non-fatal: a read-only or missing working
 * directory must never stop beecork from running, it just means no record. Idempotent.
 */
export async function startJournal(model: string): Promise<void> {
  if (file || disabled) return;
  if (!config.journalEnabled) {
    disabled = true;
    return;
  }
  try {
    const dir = journalDir();
    await mkdir(dir, { recursive: true });
    file = join(dir, `${Date.now()}.jsonl`);
    await appendFile(file, "", "utf8");
    await chmod(file, 0o600).catch(() => {}); // may name paths and commands the agent touched
    record({ type: "session_started", model, cwd: process.cwd() });
    await flushJournal();
    await prune(dir).catch(() => {});
  } catch {
    disabled = true; // no journal this session; everything else carries on untouched
    file = null;
  }
}

/**
 * Append one event. Synchronous and never throws — call sites are on the hot path of the agent loop
 * and must not have to care whether journaling works. The row is buffered; flushJournal() puts it on
 * disk, and the loop flushes at tool boundaries so a hard kill still leaves the record behind.
 */
export function record(ev: AgentEvent): void {
  if (!file || disabled) return;
  const row: JournalRow = { v: 1, seq: ++seq, time: new Date().toISOString(), ...ev };
  try {
    pending.push(JSON.stringify(row) + "\n");
  } catch {
    /* an un-stringifiable row is dropped rather than breaking the turn */
  }
}

/** Write everything buffered. Serialized through one chain so appends can never interleave. */
export function flushJournal(): Promise<void> {
  if (!file || disabled || pending.length === 0) return writing;
  const batch = pending.join("");
  pending = [];
  const target = file;
  writing = writing.then(() => appendFile(target, batch, "utf8")).catch(() => {
    disabled = true; // disk full / permissions changed mid-session — stop trying, keep agenting
  });
  return writing;
}

/** Where this session's journal lives (null when journaling is off) — for /journal and diagnostics. */
export const journalPath = (): string | null => file;

// Keep the directory bounded, like .beecork/sessions/. Oldest first, best-effort.
async function prune(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
  if (files.length <= config.maxJournals) return;
  const dated = await Promise.all(
    files.map(async (f) => ({ f, t: await stat(join(dir, f)).then((s) => s.mtimeMs).catch(() => 0) })),
  );
  dated.sort((a, b) => a.t - b.t);
  for (const { f } of dated.slice(0, dated.length - config.maxJournals)) {
    await unlink(join(dir, f)).catch(() => {});
  }
}

/** Test-only: reset module state so one test's journal can't bleed into the next. */
export function resetJournalForTests(): void {
  seq = 0;
  file = null;
  pending = [];
  writing = Promise.resolve();
  disabled = false;
}
