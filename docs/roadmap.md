# beecork capability roadmap — evaluated against deepcode-cli

**Purpose.** A curated, prioritized list of capabilities beecork could gain, mostly surfaced by
comparing against [deepcode-cli](https://github.com/lessweb/deepcode-cli). This is a *working
document*, not a promise to build everything. We add things **one at a time**, and only after we
understand the mechanism, evaluate whether it fits beecork's identity, and decide *why*.

## beecork's identity (the filter every item must pass)

Anything we add has to still be true to what beecork is. If a feature fights these, it's probably a
"no" no matter how shiny:

1. **Small & transparent** — you can read the whole agent in an afternoon (~3.5k LOC, flat `src/`, no framework).
2. **Model-agnostic via OpenRouter** — NOT deepseek-only. Anything model-specific must be done the
   OpenRouter-idiomatic way, or gated by capability, never hardcoded to one vendor.
3. **Path-confined & safe by default** — tools confined to the project root; a permission gate on
   anything outside it or any shell.
4. **Token-economical** — e.g. the `show` tool renders for the user but returns only a short note to
   the model. We don't bloat context.
5. **BYOK, no phone-home** — no telemetry, no surprise network calls.

## How deepcode differs (context for the list)

deepcode is a **gemini-cli fork** whose prompts are **Claude Code's prompts** (extracted from the
public npm bundle) aimed at deepseek-v4. It is much larger (~22k LOC, React/Ink TUI, a VSCode
companion, disk-backed sessions). Its single most outcome-relevant trait: it **turns on deepseek
thinking + `reasoning_effort=max`**, which beecork currently does not send at all. Treat every
borrowed idea on its own merits — deepcode did not validate these choices, it inherited them.

---

## Status legend

`TODO` not started · `EVALUATING` in the understand/decide phase · `DECIDED: build` · `DECIDED: skip`
· `IN PROGRESS` · `DONE`

## Priority table

| # | Item | Why it matters | Effort | Fits identity? | Status |
|---|------|----------------|--------|----------------|--------|
| 1 | **Reasoning-effort control** | Biggest outcome lever, cheapest to add, model-agnostic via OpenRouter | S–M | ✅ strong | `DONE` (2026-07-09) |
| 2 | **Robust `edit_file` (self-healing)** | Failed edits are the #1 friction in agentic coding; self-heal raises completion rate | M | ✅ strong | `DONE` (2026-07-09) |
| 3 | **`ask_user` structured clarify tool** | Cuts wrong-assumption failures; fits interactive TTY use | S–M | ✅ good | `DONE` (2026-07-09) |
| 4 | **Richer environment context** | Cheap; stops the model guessing env (git state, tool availability, versions) | S | ✅ good | `DONE` (2026-07-09) |
| 5 | **Better compaction prompt** | Long-session reliability; current summary prompt is one sentence | S | ✅ good | `DONE` (2026-07-09) |
| 6 | **Background `run_bash`** | Enables dev servers / long tasks the agent can start then poll | M | ⚠️ adds process mgmt | `DONE` (2026-07-09) |
| — | **Mid-turn steering** *(beyond deepcode)* | Type while it works; picked up next step without cancelling | M | ✅ good | `DONE` (2026-07-09) |
| — | **Sub-agents (`explore`)** *(beyond deepcode)* | Read-only child explores + returns a summary; parent context stays clean | L | ✅ good | `DONE` (2026-07-09) |
| — | **Live status line** *(deepcode-derived)* | Glanceable model · effort · branch · ~tokens · bg tasks on the bottom row | M | ✅ good | `DONE` (2026-07-09) |
| — | **`--dangerously-skip-permissions`** *(Claude-Code-inspired)* | Opt-in bypass of the whole gate for sandboxes; readonly + catastrophic floors hold | S | ⚠️ danger, opt-in | `DONE` (2026-07-09) |
| — | **Loop hardening: `sanitizeSession` tool-pairing** | Drop a crash-persisted dangling tool group on `/resume` so it can't 400 | S | ✅ good | `DONE` (2026-07-09) |
| — | **Web-injection hardening** | Strip invisible/zero-width/bidi/tag chars from fetched content + breakout-hardened UNTRUSTED fence | S | ✅ good | `DONE` (2026-07-09) |
| — | **`AGENTS.md` / `CLAUDE.md` support** | Read the cross-tool standard project-instructions files (lower-trust tier) | S | ✅ good | `DONE` (2026-07-09) |
| — | **System-prompt hardening** | Adopted the worthwhile Claude-Code/deepcode prompt patterns (shell-out discipline, follow-conventions, no-assume-libraries, no-fabricated-URLs, no-proactive-files, no-unprompted-commits) | S | ✅ good | `DONE` (2026-07-09) |

**Decided NOT to build** (this session, with reasons): prompt-caching for Claude (cheap models cache
automatically; only Anthropic needs `cache_control`, which would add provider-specific plumbing against
beecork's identity), an "instruction-detector" antivirus for web content (signature detection of
injection is evadable + false-positive-prone; the action-layer permission gate is the real defense),
a security-refusal clause in the prompt (beecork gates *actions*, doesn't gatekeep *tasks*), and
skills-portability (no cross-tool standard exists to adopt).
| 7 | **Edit undo / safety net** | Recoverability after a bad edit; complements path-confinement | M | ⚠️ maybe (git already helps) | `TODO` |
| 8 | **Multimodal `read_file` (images/PDF)** | Situational; many OpenRouter models are multimodal (screenshots, design PDFs) | M | ✅ if capability-gated | `TODO` |
| 9 | **Desktop notifications** | QoL for long autonomous runs ("done / needs you") | S | ✅ opt-in only | `TODO` |
| 10 | **MCP support** | Highest capability ceiling (external tools), highest cost/complexity | L | ⚠️ decide deliberately | `TODO` |

Effort: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

### Explicitly rejected (and why)

- **React/Ink TUI rewrite** — betrays identity #1. beecork's hand-rolled I/O is a feature, not debt.
- **VSCode companion / monorepo split** — out of scope; different product.
- **Telemetry** (`telemetry.ts`) — violates identity #5.
- **bash `sideEffects` scope negotiation** — deepcode makes the model self-declare permission scopes
  per command. beecork's heuristic classifier + out-of-root guard is simpler and already safe; the
  negotiation model adds prompt weight and a trust surface without clear payoff. Revisit only if #10
  (MCP) forces a richer permission model.
- **Chinese-first base prompt** — irrelevant; beecork is English-native.

---

## Detailed dossiers

Each item gets filled in during its EVALUATING phase before any code is written. Template per item:
*what it is · how deepcode does it · how beecork should do it · effort · risks/tradeoffs · open
questions (decision gate) · decision.*

### 1. Reasoning-effort control — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#1-reasoning-thinking-effort-control--2026-07-09)

**What it is.** Explicitly ask the model to think harder (or not) before answering, and let the user
dial it. beecork today sends `{model, messages, tools, stream}` — no reasoning knob at all, so it
gets each provider's default.

**How deepcode does it.** deepseek-specific: `thinking: {type:"enabled"}` + `extra_body:
{reasoning_effort: "max"}`. Hardcoded to one vendor — the wrong altitude.

**Research (OpenRouter live docs, 2026-07).** OpenRouter normalizes every provider's thinking
mechanism into ONE unified `reasoning` param, so we write it once, model-agnostic:

```jsonc
"reasoning": {
  "effort": "high",     // "max"|"xhigh"|"high"|"medium"|"low"|"minimal"|"none"
  "max_tokens": 2000,   // OR a direct budget (Anthropic min 1024, cap 128k)
  "enabled": true,      // on with defaults (== medium)
  "exclude": false      // compute thinking but omit it from the response
}
```

Provider mapping (OpenRouter translates): DeepSeek `effort` · OpenAI/Grok `effort` only · Anthropic
`max_tokens` or `effort` → `thinking.budget_tokens` · Gemini `effort` → `thinkingLevel` · Qwen
`max_tokens` → `thinking_budget`. Legacy top-level `reasoning_effort` and `include_reasoning` also
accepted. `effort` is the portable interface; `max_tokens` is precise but not universal.

Response carries thinking in `message.reasoning` (string) + `message.reasoning_details[]`
(structured); streaming puts it in `delta.reasoning_details`. Per-model metadata is discoverable at
`GET /models` under `reasoning: {supported_efforts, default_effort, default_enabled,
supports_max_tokens, mandatory}`, and `supported_parameters` includes `"reasoning"` when supported.

**How beecork should do it.** Use the unified `reasoning.effort`. Capability-gate on
`supported_parameters.includes("reasoning")` — beecork ALREADY reads that array in `/model`. Config
default (`REASONING_EFFORT`) + a `/think` slash command to change live (persisted like `/model`).

**Three findings that shape the build:**
1. *Gating is free* — reuse the `supported_parameters` beecork already fetches.
2. *Cost is real* — reasoning tokens bill as OUTPUT tokens; the default level is a genuine
   cost/quality decision.
3. *Tool-call continuity (the trap)* — some providers (Anthropic esp.) require `reasoning_details`
   to be preserved and RESENT on assistant messages that carry tool calls, or the next request in a
   multi-step turn errors. beecork's `Message` type currently keeps only `content` + `tool_calls`
   and DISCARDS reasoning. So the build must capture `reasoning_details` and replay it for tool
   turns. This is what turns a 20-min change into a careful one.

**DECISION (2026-07-09): build.** Finalized spec:
- **Interface:** OpenRouter unified `reasoning.effort`. "thinking" = the capability (on/off);
  "effort" = the depth dial. `effort: "none"` == off. Expose levels `off|low|medium|high|max`.
- **Default:** `medium`, on — but only for models whose `supported_parameters` includes
  `"reasoning"`. Others get no `reasoning` field.
- **Control:** a `/effort <level>` slash command (named for the field, matches Claude Code
  terminology) + a `REASONING_EFFORT` env default; persisted across restarts like `/model`.
- **Display:** stream the reasoning dimly as it arrives (parse `delta.reasoning` /
  `delta.reasoning_details`), distinct from the answer text.
- **Continuity:** capture `reasoning_details` on assistant messages and RESEND it on tool-call
  turns (required by Anthropic et al.). Extend the `Message` type accordingly.
- **Sampling escape hatch:** add `OPENROUTER_EXTRA` (JSON env) merged into the request body — full
  coverage of temperature/top_p/seed/etc. for power users, zero UI surface. Reasoning stays
  first-class and separate.

**Status:** ready to implement (see build plan in chat / next commit). Ledger entry to be written to
`addedfromdeecode.md` on ship.

### 2. Robust `edit_file` — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#2-self-healing-edit_file--2026-07-09)

**What it is.** Make edits survive trivial formatting drift instead of hard-failing. Old behavior:
`old_text` had to match exactly and once, else a bare "re-read" error — one wasted step per miss.

**Compared the real code.** Claude Code = strict exact match, no healing (relies on a frontier model
+ prompt discipline). deepcode = 867-line cascade: snippet_id anchoring + loose-escape FUZZY matching
+ an extra LLM call to fix escaping. beecork was Claude-Code-strict but paired with *cheap* models —
the worst pairing.

**DECISION (2026-07-09): build the SAFE middle.** Shipped a 4-tier pure `resolveEdit`:
exact → strip pasted read_file line-number prefix → UNIFORM indentation/trailing-whitespace shift
(reindent new_text by the same shift) → closest-actual-text feedback (exact-trim or word-overlap
near-miss). Deliberately **no** fuzzy code matching and **no** LLM auto-correction (deepcode's two
heavy layers). Invariant held: a heal changes *whether* a match lands, never *which* region is edited.
~110 lines vs deepcode's 867. See ledger for files/tests/known-minor.

### 3. `ask_user` structured clarify tool — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#3-ask_user-structured-clarify-tool--2026-07-09)
Built the beecork-shaped version: one question, single-select, reusing the `selectMenu` picker;
intercepted in the turn loop (needs the keyboard). Decision A: ask whenever a human is at the terminal;
headless → proceed-with-default. Details/tests in the ledger.


**What it is.** A tool that lets the model pause and ask a real question with options, instead of
guessing on ambiguous tasks. beecork's model can only ask in prose today.

**How deepcode does it.** `AskUserQuestion` tool → questions with labelled options, rendered by the
Ink TUI as a picker.

**How beecork should do it.** A tool that prints a numbered choice list and reads the answer via the
existing `ask()` path (beecork already has an interactive prompt). Headless mode must have a defined
behavior (auto-pick default? refuse?).

**Open questions.** how does it behave under `AUTO_APPROVE`/headless? does it risk the model
over-asking instead of acting (beecork's prompt says "keep going")?

**Decision.** _pending evaluation_

### 4. Richer environment context — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#4-richer-environment-context--2026-07-09)
New `src/env.ts` injects a tight `# Environment` block (date, cwd, platform, node, git branch+dirty, rg
availability) at startup. Best-effort probes; kept token-lean vs deepcode's big dump.


**What it is.** Give the model more accurate facts about its environment up front so it stops
guessing. beecork injects only `cwd` + `platform`.

**How deepcode does it.** Injects date, model, uname, shell path, node/python versions, and whether
`rg`/`jq` are installed.

**How beecork should do it.** A small, cheap block: date, git branch/dirty state, maybe runtime
versions and tool availability. Keep it tight (token economy).

**Open questions.** which facts actually change model behavior vs just cost tokens? recompute per
turn or once per session?

**Decision.** _pending evaluation_

### 5. Better compaction prompt — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#5-better-compaction-prompt--2026-07-09)
`context.ts` summarizer now uses a 5-heading structured template (Goal / Done / Facts / Errors & fixes /
Pending), a trimmed take on deepcode's Claude-Code-derived one.


**What it is.** beecork compacts old messages with a one-sentence summarizer. deepcode uses Claude
Code's structured `<analysis>/<summary>` summarizer that preserves user intent, files touched,
errors+fixes, pending tasks.

**How beecork should do it.** Adopt a *trimmed* structured summary (not the full Claude Code wall of
text) tuned to beecork's flat message model.

**Open questions.** how much structure before it costs more than it saves? does it need the "all user
messages verbatim" section?

**Decision.** _pending evaluation_

### 6. Background `run_bash` — `DONE` (2026-07-09) → see [`addedfromdeecode.md`](../addedfromdeecode.md#6-background-tasks--2026-07-09)
`run_bash background:true` → `src/tasks.ts` registry + `check_task`/`stop_task`; rolling tail buffer;
synchronous `killAllTasks()` on exit (detached children survive us otherwise). Verified: no orphans.

### Mid-turn steering — `DONE` (2026-07-09) *(beyond deepcode — Claude-Code-inspired)*
Type a note while the agent works; it's queued by the mid-turn key handler and injected as a
`role:"user"` message at the top of the next step (pure `applySteering` in `agent.ts`, unit-tested;
preserves assistant→tool pairing). TTY-only; spinner mutes while typing. Not a deepcode feature → no
ledger entry.

### Sub-agents — the `explore` tool — `DONE` (2026-07-09) *(beyond deepcode — Claude-Code-inspired)*
`explore` spawns a READ-ONLY child (read_file/search/list_dir/web_fetch/web_search; no write/run/ask;
no recursion) that investigates in its own context and returns a summary — parent context stays clean.
New `src/subagent.ts` (pure `exploreLoop` + IO shell); reuses the safe leaf primitives (`decideApproval`
gate with `{readonly, autoApprove:true}` + a restricted dispatch map = the security boundary), not the
orchestrator. `callModel` gained `{tools, quiet}`. Verified live (accurate findings, quiet child). Not a
deepcode feature → no ledger entry.

**What it is.** Start a long/blocking process (dev server) and keep working, polling its log.
beecork's `run_bash` is synchronous only.

**Open questions.** process lifecycle (kill on turn end?), log capture, how the model stops it,
interaction with the permission gate. This is real added surface — evaluate whether the use cases
justify it.

**Decision.** _pending evaluation_

### 7. Edit undo / safety net — `TODO`

**What it is.** deepcode has `file-history.ts` + an `UndoSelector` to revert edits. beecork relies on
the user's git. Evaluate whether a lightweight per-session edit journal (revertible) adds real safety
beyond git.

**Decision.** _pending evaluation_

### 8. Multimodal `read_file` — `TODO`

**What it is.** Read images/PDFs/notebooks, not just text. Value depends on the active model being
multimodal — so **capability-gate** it.

**Decision.** _pending evaluation_

### 9. Desktop notifications — `TODO`

**What it is.** Notify when a long run finishes or needs input. Cheap, must be **opt-in**.

**Decision.** _pending evaluation_

### 10. MCP support — `TODO`

**What it is.** Model Context Protocol — connect external tool servers. Biggest capability ceiling
(extensibility), biggest cost (client + manager + config + a bigger permission story). Deliberately
last: decide *whether* beecork should be extensible this way at all, or stay a tight closed toolset.

**Decision.** _pending evaluation_

---

## Working method

1. Pick the top `TODO`.
2. Move it to `EVALUATING`; fill in its dossier (mechanism, fit, risks, open questions).
3. Resolve the open questions together → `DECIDED: build` or `DECIDED: skip`.
4. If build: implement in the smallest honest slice, with a test, respecting identity.
5. Mark `DONE`, note what shipped, move to the next.

No blind copying. Every item earns its place.
