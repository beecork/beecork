# Added to beecork (surfaced by comparing with deepcode-cli)

A ledger of every capability we deliberately added to beecork after evaluating it against
deepcode-cli. One entry per shipped change, so it can be tracked later.

**Rule:** nothing goes in here until we've (a) understood it, (b) decided *why*, and (c) actually
shipped it. Evaluation-in-progress lives in [`docs/roadmap.md`](docs/roadmap.md); this file records
only what landed.

Entry format:

```
## <n>. <Title>  —  <date>
**What shipped:** …
**Why:** …
**How (files/knobs):** …
**Deviation from deepcode:** … (how our version differs and why)
**Tests:** …
```

---

<!-- entries appended below as we ship, most recent last -->

## 1. Reasoning ("thinking") effort control — 2026-07-09

**What shipped:** beecork can now ask the model to reason before answering, at a user-chosen depth.
`/effort <off|low|medium|high|max>` (menu when bare) sets it live and persists it across restarts;
`REASONING_EFFORT` sets the startup default (default `medium`). The thinking streams **dimly** on a
TTY, distinct from the answer (never pollutes piped/eval output). Also added `OPENROUTER_EXTRA` — a
JSON escape hatch merged into every request body for the ~15 sampling / provider-routing params we
chose not to surface as first-class UI.

**Why:** With the model held constant, the harness is the whole difference. Explicitly enabling
reasoning is the single biggest lever on answer quality for multi-step coding — and it was the one
thing deepcode did that beecork didn't send at all. (deepcode's version is deepseek-only; see the
deviation below.)

**How (files/knobs):**
- `config.ts` — `ReasoningEffort` type, `EFFORTS`, `normalizeEffort`, `reasoningEffort`
  (from `REASONING_EFFORT`), `openRouterExtra` (from `OPENROUTER_EXTRA`).
- `state.ts` — live `reasoningEffort`. `types.ts` — `Message.reasoning` / `reasoning_details`.
- `api.ts` — pure `buildRequestBody` (wires `reasoning.effort`, gates on support, merges the escape
  hatch while protecting structural fields) + `pruneReasoningForSend`; `parseSSELine` now surfaces
  reasoning deltas; the stream loop displays thinking dimly and captures it onto the message.
- `capabilities.ts` (new) — lazy, cached, **fail-open** lookup of which models support `reasoning`
  (reuses the `/models` `supported_parameters` array beecork already reads).
- `commands.ts` — `/effort` command + menu + completion. `memory.ts` — load/save the preference.
  `index.ts` — apply it at startup (env wins over saved).

**Deviation from deepcode:** deepcode hardcodes deepseek's `thinking:{type} + extra_body.reasoning_effort`
(one vendor). We use OpenRouter's **unified `reasoning` param**, so it works across every provider and
is capability-gated. We also handle the tool-call **continuity trap** deepcode's borrowed-from-Claude-Code
design doesn't need to think about here: `reasoning_details` are captured and replayed for the current
turn's tool chain (required by Anthropic et al.) but **pruned from older turns** to save tokens.

**Tests:** `api.test.ts` — reasoning SSE parsing, `buildRequestBody` (effort/off/gating, escape-hatch
merge protects structural fields, `extra.reasoning` override), `pruneReasoningForSend` (keeps only the
current turn's chain, pure). Full suite green (58 tests); headless smoke test of `/effort`
set/error/no-arg/persist verified.

## 2. Self-healing `edit_file` — 2026-07-09

**What shipped:** `edit_file` no longer hard-fails on trivial formatting drift. When `old_text` doesn't
match exactly, it recovers the two SAFE, unambiguous cases against the file's real bytes: (a) a pasted
`read_file` line-number prefix (stripped from both old and new), and (b) a UNIFORM indentation /
trailing-whitespace shift (new_text is reindented by the same shift). On a genuine mismatch it returns
the **closest actual line** — exact-trimmed match, or a word-overlap near-miss (for typos) — so the
model fixes it in one retry instead of blindly re-reading. The exact-match happy path is byte-identical.

**Why:** Failed edits are the #1 friction in agentic coding, and they hit beecork *harder* than a
frontier-model agent: beecork pairs cheap/drifting models (deepseek-flash, GLM) with a strict tool, and
every miss burns a step + a re-read against a 50-step budget and a 3-strike loop cutoff. beecork even
*shows* the line-number prefix that models then paste back. Healing the safe cases converts 2–4-step
failures into one success.

**How (files/knobs):** `tools.ts` — new pure `resolveEdit(file, oldText, newText)` with a 4-tier
cascade (exact → prefix-strip → uniform-whitespace → closest-text feedback), returning byte offsets;
`edit_file.run` now slices-and-splices at those offsets (literal insert, no `$`-expansion) and reports
which heal fired. No schema/prompt change — the model calls it exactly as before.

**Deviation from deepcode:** deepcode's `edit-handler.ts` is 867 lines: snippet_id anchoring, loose-escape
FUZZY matching, and an extra **LLM call** to auto-correct escaping. We took only its *safe* layers
(prefix-strip + candidate feedback) and added safe uniform-indent healing — **~110 lines, no fuzzy code
matching, no extra model call**. Rule we held: a heal may fix *whether* a match lands, never *which*
region is edited. (Claude Code, by contrast, does no healing at all — it relies on a frontier model +
prompt discipline; that pairing doesn't hold for beecork's cheap models.)

**Known minor:** the approval diff in `agent.ts` still previews the model's raw `old_text`/`new_text`,
not the healed region (semantic change is identical since heals are formatting-only). Candidate for a
later polish. **Tests:** `tools.test.ts` — exact/ambiguous/not-found, prefix-paste heal, uniform-indent
heal + reindent, non-uniform refusal (safety), exact + word-overlap closest feedback. Full suite green
(65 tests); end-to-end `runTool` heal write verified.

## 3. `ask_user` structured clarify tool — 2026-07-09

**What shipped:** a tool the model calls when it hits a genuine fork — an ambiguous request or several
valid approaches with different outcomes — instead of guessing or stopping in prose. It presents 2–4
options in beecork's **native arrow-key picker** (the same `selectMenu` behind `/model` and `/effort`)
and hands the choice back to the model. Headless/piped runs get a "proceed with a default" message so
autonomous runs never hang.

**Why:** "guessed wrong instead of asking" is a top failure class; a structured pick beats prose
back-and-forth and matches how a human wants to answer (arrow + Enter).

**How (files):** `tools.ts` — `ask_user` ToolDef (schema + a headless fallback `run()`). `agent.ts` —
pure `askUserMessage` (result text) + `handleAskUser` (validate → picker → result), intercepted in
`handleToolCall` before the approval gate (ask_user needs the keyboard, which normal tools don't get,
and it never mutates). `SYSTEM_PROMPT` gained a "use sparingly, only for real decisions" line.

**Deviation from deepcode:** deepcode's `AskUserQuestion` takes an array of questions with multiSelect,
rendered by its React/Ink TUI. We did the beecork-shaped version: **one question, single-select**,
reusing the existing picker — no new UI. **Decision (A):** we ask whenever a human is at the terminal;
`AUTO_APPROVE` only skips *safety* prompts, not genuine product decisions (headless has no TTY → the
proceed-with-default fallback fires).

**Tests:** `tools.test.ts` — headless/validation `run()`; `approval.test.ts` — `askUserMessage`
(selected / dismissed / headless). Interactive `selectMenu` path is shared, already-exercised code.

## 4. Richer environment context — 2026-07-09

**What shipped:** the system prompt now opens with a real `# Environment` block — date, working dir,
platform+arch, Node version, **git branch + dirty count**, and whether **ripgrep** is available —
instead of just cwd + platform. So the model works from reality (e.g. knows the tree is dirty, knows
`rg` isn't installed) rather than guessing and wasting steps.

**How (files):** new `src/env.ts` — best-effort probes (`gitStatus`, `tryExec` with a 2s timeout) +
a pure `formatRuntimeContext`; gathered once at startup in `index.ts` and prepended to the system
prompt. The old static "Environment:" lines were removed from `SYSTEM_PROMPT` (now owned by env.ts).

**Deviation from deepcode:** deepcode injects a large env dump (uname, shell path, python/node,
rg+jq). We kept it **tight** (6 high-signal lines, token economy) and best-effort (any failed probe
degrades gracefully). **Tests:** `env.test.ts` — `formatRuntimeContext` (pure); gathering is IO,
smoke-verified live (showed real git dirty-count + rg detection).

## 5. Better compaction prompt — 2026-07-09

**What shipped:** when a long session is summarized to fit the context window, the summarizer now uses
a **structured** instruction (Goal / Done / Facts / Errors & fixes / Pending) instead of a single
vague sentence — so post-compaction the model keeps user intent, files touched, and pending work
instead of a lossy blur.

**How (files):** `context.ts` — replaced the one-line `summarize()` system prompt with the 5-heading
template. No new surface; behavior unchanged except the prompt text.

**Deviation from deepcode:** deepcode uses Claude Code's very large `<analysis>/<summary>` template.
We used a **trimmed** 5-heading version tuned to beecork's flat message model (enough structure for
continuity, not a token-heavy wall). **Tests:** none added — it's a prompt string; existing
`context.ts` compaction-boundary tests still green.

## 6. Background tasks — 2026-07-09

**What shipped:** `run_bash` gained a `background: true` option that spawns the command detached and
returns a task id immediately (dev servers, watchers, long builds). Two new tools — **`check_task`**
(status + output produced since the last check) and **`stop_task`** (kill it). Tasks persist across
turns within a session and are all killed on exit.

**Why:** a coding agent that can't start a dev server / test-watcher and keep working is crippled for
real iterative work. This unblocks "run it, then test against it."

**How (files/knobs):** new `src/tasks.ts` — session registry (`Map`), `startTask`/`checkTask`/`stopTask`
reusing `runShell`'s detached-spawn + `process.kill(-pid)` group-kill idiom, a **rolling tail buffer**
(pure `appendTail`/`readSince`, unit-tested) so a long-lived server's output never grows unbounded, and
a **synchronous `killAllTasks()`** wired into `index.ts`'s `'exit'` handler (registered unconditionally
— every deliberate exit funnels through `process.exit`). `run_bash` background branch + `check_task`/
`stop_task` in `tools.ts`; knobs `MAX_BG_TASKS` (5), `BG_TAIL_CHARS` (100k). Running-task count shown in
the status line.

**The trap we handled:** a detached child that beecork stops awaiting **survives process exit** (a
group leader isn't reaped with its parent). Verified live: started `sleep 60`, exited the process,
confirmed no orphan (`killAllTasks` reaped it); `stop_task` kills a live process (pgrep 1→0).

**Deviation from deepcode:** deepcode writes background output to temp-file logs the model reads via
`cat`, and hands the model a raw `kill` shell command. We keep output in an **in-memory rolling buffer**
(no repo/temp junk, respects path-confinement) and give **dedicated `check_task`/`stop_task` tools**
(cleaner than shell pid-killing). **Tests:** `tasks.test.ts` — pure buffer/cursor helpers, real
start→check→exit, `stopTask` kill, unknown-id → Error; live orphan-reaping smoke.

---

*Mid-turn steering and Sub-agents (the `explore` tool) were also shipped in this batch but are NOT
from deepcode (deepcode has neither) — they are tracked in [`docs/roadmap.md`](docs/roadmap.md) as
original, Claude-Code-inspired additions.*
