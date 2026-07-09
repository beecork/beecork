# Ideas borrowed from openclaw & hermes-agent

A ledger of mechanisms adopted into beecork after studying two much larger agent platforms —
[openclaw](https://github.com/openclaw/openclaw) (a channel-native always-on assistant) and
[hermes-agent](https://github.com/NousResearch/hermes-agent) (a self-improving agent platform). Same
rule as `addedfromdeecode.md`: only things that fit beecork's identity (small, transparent,
path-confined, token-economical, BYOK — no daemon, no DB, no new heavy deps), evaluated one at a time,
and only the *idea* is borrowed — never the platform machinery.

Kept out of scope by design: the gateway/channels/companion apps, cron scheduler, external
execution backends (Docker/SSH/Modal/Daytona), Honcho's user-modeling service, ACP. Those make a
platform; beecork is a tool.

---

## 1. Progressive skill disclosure — DONE (from openclaw)

**Before.** Skills (`.beecork/skills/*.md`) were purely manual — a skill only ran when the *user* typed
`/name`. The model had no idea they existed.

**Now.** The model sees a compact one-line menu of skills (name + description) in its system prompt and
loads the full text on demand with a new `read_skill` tool — so a skill you wrote once gets applied
automatically when a task matches it, at ~one line of context per skill instead of every skill's full
body.

**What shipped**
- `skills.ts`: `parseSkill()` reads an optional `---` frontmatter block for `description:` and a
  `model-invocation: false` (or `disable-model-invocation: true`) opt-out; the body is stored
  frontmatter-stripped so `/name` expansion stays clean. No frontmatter → description falls back to the
  first meaningful line (fully backward-compatible with existing skills). `skillsPrompt()` builds the
  advertisement, excluding opted-out skills.
- `read_skill(name)` tool (`tools.ts`): loads a skill's text from the registry by name — no path, so it
  sidesteps the out-of-root approval gate that a global skill under `~/.beecork/skills/` would otherwise
  trip. Read-only, available in every mode.
- `index.ts`: injects the advertisement into the system prompt after the project-instructions block.

**Safety.** Descriptions are `stripControl`'d and length-capped before entering the system prompt.
Project skills are tagged `(project)` and the advertisement tells the model to treat repo-provided
skills as conventions, never as authority to bypass safety — mirroring how project `cork.md` is fenced.
Global (user-owned) skills still win name clashes.

**Why it fits.** Upgrades an existing feature into a model-usable one at near-zero token cost; small,
dependency-free; on-brand (token-economical, transparent). Tests: `skills.test.ts` (parse, fallback,
opt-out, advertisement).

---

## 2. Memory that maintains itself — DONE (from hermes)

**Before.** The `remember` tool only ever *appended* to `.beecork/memory.md`; the file grew unbounded and
accumulated stale/duplicate lines, and nothing ever prompted the model to save in the first place.

**Now — two parts (the third, a separate `USER.md`, was deliberately held):**

- **(b) Consolidation budget.** `remember` is capped at `config.memoryMaxChars` (default 4000, kept well
  under the 8k read-budget so memory is never truncated on load). When a save would blow the budget, it's
  refused with an instruction to consolidate — the model reads `.beecork/memory.md`, merges duplicates /
  drops stale lines, `write_file`s the shorter version, and retries. The frequent append path stays
  atomic (crash-safe); the rare rewrite is an explicit model action, so the safety property the
  append-only design protected is preserved. Config: `MEMORY_MAX_CHARS`.
- **(a) Light nudge.** Every `config.memoryNudgeInterval` user turns (default 8; `MEMORY_NUDGE_INTERVAL=0`
  disables), a short automatic reminder to save durable facts is injected — but only when writes are
  allowed (not read-only mode), and the prior reminder is filtered out first so they never pile up in
  history. Framed clearly as an automatic reminder, not the user speaking, so the model doesn't mistake
  it for a save request.

**Held: (c)** a separate `USER.md` (facts about the user, hermes-style) — adds a concept that overlaps
beecork's existing `cork.md` (you write) vs `memory.md` (agent writes) split, for modest gain. Revisit later.

**Why it fits.** Keeps memory lean and high-signal (token-economical) and makes the flywheel proactive,
with zero new deps and the crash-safe append path intact. Tests: `remember.test.ts` (over-budget refusal
leaves the file untouched; under-budget append; empty-fact guard).

---

## 3. Cross-session search — SKIPPED (from hermes)

A tool to grep past `.beecork/sessions/*.json` transcripts and surface snippets. **Decided against**, by
the "brings-not-much-but-adds-complexity → skip" rule:
- Real, non-incidental complexity: session files are single-line JSON transcripts, so a useful tool must
  parse them, extract clean human/assistant snippets out of the tool-call noise, rank, and cap — exactly
  where fiddly bugs live (~50+ lines).
- Modest value for a *coding* agent: code is the source of truth, git records changes, `memory.md` holds
  durable facts — session search only recovers what was *discussed*, a thin slice.
- Mild downside: sessions are full transcripts (chmod 600 — they can hold file contents / command
  output), so a search tool *resurfaces* that sensitive content into fresh context.
- Trivial to add later if per-project recall ever becomes an actual pain point.

## 4. Untrusted-content hardening — DONE (from openclaw)

**Before.** beecork already fences fetched web content, neutralizes fence-forgery (scrubs the sentinel
word), and strips invisibles; `htmlToText` also drops every `<…>` form, which removes angle-bracket
control tokens from HTML. Gap: **non-HTML** untrusted content — a plain-text/JSON `web_fetch` or
`web_search` snippet — never passes through `htmlToText`, so model chat-template control tokens survive
into what the model reads.

**Now.** `stripControlTokens()` (`html.ts`) removes chat-template / role markers — `<|im_start|>`,
`<|eot_id|>`, `<|endoftext|>`, `[INST]`/`[/INST]`, `<<SYS>>`, `<s>`/`</s>`, `<start_of_turn>`, … — so a
page/snippet can't smuggle a fake turn boundary. Applied at both untrusted boundaries: inside
`wrapUntrusted`'s neutralizer (web_fetch, any content type) and the `web_search` snippet mapping.

**Deliberately dropped:** the homoglyph-bracket idea from openclaw — beecork's fence uses square brackets
+ a scrubbed sentinel *word*, not angle brackets, so bracket-homoglyph spoofing doesn't apply; adding it
would be complexity for a stretch attack.

**Why it fits.** Pure defensive hardening on the untrusted path, no user-facing change, no downside; only
transforms untrusted *display* data (never code we run). Tests: `html.test.ts` (token stripping;
wrapUntrusted strips them on the non-HTML path).

---

---

# From the 2026 harness-engineering deep-dive

A later internet search of mid-2026 CLI-agent best practice (the "12 agentic harness patterns", the
compaction research, Anthropic's Claude Code auto-mode writeup) mostly *validated* beecork's design, and
surfaced three more worth building.

## 5. Graduated approval (deterministic) — DONE (openclaw / Claude Code pattern #10)

**Why.** The data: users approve ~93% of permission prompts → approval fatigue makes the gate
unreliable. beecork asked for *every* shell command in normal mode (`ls` prompted like `rm`).

**Now.** `isSafeBash()` (`safety.ts`) auto-approves a shell command **only** if it's provably safe —
first word in a small read-only allow-list (`ls cat head tail wc grep rg find pwd stat …`, or `git`
with a pure-read subcommand `status/diff/log/show/blame/…`), **no shell metacharacters at all**
(`| & ; < > ` $ ( ) { } \ !` / newlines), and not matched by `RISKY_BASH`/`DANGEROUS_BASH`/out-of-root.
Wired as a new `ToolDef.safeAutoApprove` hook honored in `decideApproval` **after** the hard guard, so a
risky/out-of-root call still asks. Deny-first: anything uncertain falls through to the normal prompt.

**Deliberately NOT the LLM classifier** that Claude Code uses (it reports a 17% false-negative rate and
adds a model call per command) — a weaker/cheaper model would miss *more*. The deterministic allow-list
has zero calls and no new attack surface. Opt out with `SAFE_BASH_APPROVE=0`. Tests: `safety.test.ts`
(safe vs unsafe corpus), `approval.test.ts` (wiring: safe→run, risky-guard-wins, readonly-blocks).

## 6. Plan mode (Explore-Plan-Act) — DONE (pattern #6)

**Why.** Separating read-only exploration from editing measurably improves decisions — and you approve
the approach before any file changes.

**Now.** A 4th mode in the `Shift+Tab` rotation (normal → auto → read-only → **plan**). In plan mode the
gate blocks everything that mutates (like read-only) but **allows provably-safe read-only shell** (via
the graduated-approval check above), so the agent can explore with `git log`/`grep`, then a per-turn
directive tells it to present a numbered plan and stop. Flip to normal to execute. `state.ts` (mode +
rotation + label), `decideApproval` (plan gate, safe-shell allowed / mutations denied — a floor that
holds even under `--dangerously-skip`), `index.ts` (`PLAN_DIRECTIVE` injected per plan-mode turn),
`chrome.ts` (statusline segment). Read-only mode stays **strict** (zero shell) on purpose. Tests:
`approval.test.ts` (plan blocks mutations, allows safe shell, reads run).

## 7. Staged compaction — SKIPPED (pattern #5)

beecork's compaction is already lean 2-tier (keep ~12 recent messages verbatim, collapse the rest into
one structured summary). "Staged" compaction deliberately *retains more* history at graduated detail —
which for a token-economical agent that already compacts hard is arguably worse (more tokens / more
context-rot), at the cost of multiple-summary-pass complexity. Skipped by the "not-much-value +
complexity" rule; the aggressive 2-tier approach is the right shape for beecork.

## Status

Original shortlist: **#1, #2, #4 built**, **#3 skipped**, **#5 (reducing-script) demoted**. Deep-dive
add-ons: **graduated approval + plan mode built**, **staged compaction skipped** (beecork's lean
compaction is already right).
