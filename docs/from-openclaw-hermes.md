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

## Status

Shortlist worked through: **#1, #2, #4 built** (tested, unshipped — batched for one release); **#3
skipped**; **#5 (reducing-script) demoted** (run_bash already covers the core, the rest needs the RPC
machinery we won't add).
