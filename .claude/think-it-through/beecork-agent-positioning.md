# Positioning the coding agent in the beecork umbrella

> Status: in progress (think-it-through). Decisions accrue as we go.

## Intention

We built a from-scratch CLI **coding agent** (currently `/coding/cliagent`, GitHub
`speudoname/beecorkcli`). It belongs under the existing **beecork** brand but is a
genuinely different product from what beecork ships today. This brief decides its
name, npm identity, repo/folder home, and how it relates to the rest of beecork.

## How it is now (verified on disk)

The beecork umbrella lives at `/Users/apple/Coding/beecork/`:
- **`beecork/`** — npm package **`beecork` v1.7.1, shipped & published.** Description:
  *"Claude Code always-on infrastructure — a phone number, a memory, and an alarm
  clock."* Channels (Telegram/WhatsApp/Discord) + SQLite memory + cron + media/voice
  + dashboard + cloud. `bin: beecork → dist/index.js`. Repo `github.com/beecork/beecork`,
  homepage `beecork.com`. ROADMAP frames it as *"a smart pipe → an AI that runs your
  life"*; its own roadmap has a *"Phase 6 — The Autonomous Agent"* and *"multi-agent
  delegation"* (so the word "agent" is already used inside this product).
- **`beecork-infra/`** — `@beecork/shared`, `beecork-admin`, `beecork-cloud` (hosted/admin).
- **`beecork-site/`** — the website.
- GitHub org `beecork`; npm org `beecork` (scoped `@beecork/*` already in use).

**The agent** (`/coding/cliagent`): modular TS, OpenRouter multi-model, 10 tools
(incl. web_fetch/web_search), path confinement, BYOK, permission gate, 33-task eval.
Private GitHub `speudoname/beecorkcli`; OpenRouter + Brave keys in CozyKey app `beecork`.

## Decisions so far

- **Relationship: separate product, shared brand.** The agent is a standalone product
  that shares the beecork name/org/site; it does NOT integrate with the pipe (siblings,
  not a system). → its own npm package, repo/folder, and docs.
- **FLAGSHIP FLIP: the coding agent becomes `beecork`** — the flagship, unscoped name
  (`npm i -g beecork`). The existing always-on product is renamed **`beecork pipe`**.
  A deliberate brand bet: the flagship name goes to the *newer* product (the agent),
  even though the pipe is the mature, shipped v1.7.1. User confirmed after that flag.
  Low cost because the pipe is **not yet public** — only the user has it installed.

- **Pipe's npm name: `beecork-pipe`** (unscoped) — parallel to `beecork`, matches the
  existing folder pattern (beecork-infra, beecork-site).

## Structure (follows from the decisions)

Target folder layout (`/coding/beecork/` is a parent of independent repos, NOT a
monorepo — verified, so `mv` preserves each repo's `.git`):
```
/coding/beecork/
  beecork/        ← the coding agent (flagship) — moved from /coding/cliagent
  beecork-pipe/   ← EVERYTHING that was beecork before: the old beecork/ (pipe),
                    beecork-infra, beecork-site, server-backups, audits, ROADMAP/RECOVERY
```
Note: `beecork-site`/`beecork-infra` are the *pipe's* today, so grouping them under
`beecork-pipe/` is fine for now. If the agent later needs its own site/infra, split then.

### Execution approach (how the user will run it)
Done in PHASES, in a FRESH session opened in `/coding/beecork` (this session closes
first, so the agent folder isn't moved out from under a live session):
- **A — Organize + document:** move folders into the layout above; write a
  `/coding/beecork/README.md`. NO npm/GitHub changes yet.
- **B — Rename + re-release the pipe** as `beecork-pipe` (package, bin, config dir, repo).
- **C — Ship the agent** as `beecork` (finish Phase 6 packaging; publish `beecork@2.0.0`).

GitHub (`beecork` org): agent → `beecork/beecork`; pipe → `beecork/beecork-pipe`
(rename pipe repo first to free the name; then transfer the agent repo
`speudoname/beecorkcli` → `beecork/beecork`).

npm: agent → `beecork` (republish at a higher major, e.g. 2.0.0); pipe → `beecork-pipe`;
deprecate the old `beecork` pointing at `beecork-pipe`. Low cost — pipe not yet public.

Nice: the agent is **already named beecork internally** (cork.md, .beecork/, 🐝 banner),
so taking the flagship name needs ~zero internal renaming. All renames are pipe/repo-side.

## Risks
- **`~/.beecork/` collision — RESOLVED:** the agent (flagship `beecork`) keeps
  `~/.beecork/`; the pipe moves to **`~/.beecork-pipe/`** via its existing `BEECORK_HOME`
  override (its `paths.ts` default changes; the user's existing pipe data migrates there).

## Decision (final)

| | Was | Becomes |
|---|---|---|
| **Agent** (what we built) | `cliagent` / `beecorkcli` | **`beecork`** — flagship, unscoped npm, `~/.beecork/`, `beecork` command |
| **Pipe** (always-on infra) | `beecork` | **`beecork-pipe`** — unscoped npm, `~/.beecork-pipe/`, `beecork-pipe` command |

Relationship: **separate products, shared brand** (no integration). Deliberate brand
bet: the flagship name goes to the newer agent. Low cost — the pipe isn't public yet.

## Execution sequence (order matters)

**Pipe side** (rename `beecork` → `beecork-pipe`):
1. `mv /coding/beecork/beecork /coding/beecork/beecork-pipe`.
2. `package.json`: name `beecork-pipe`, `bin` → `beecork-pipe`, repo/homepage updated.
3. `paths.ts`: default config dir `~/.beecork` → `~/.beecork-pipe`; migrate existing data.
4. GitHub: rename repo `beecork/beecork` → `beecork/beecork-pipe` (frees the name).
5. npm: publish `beecork-pipe`; **deprecate** old `beecork@1.x` → "renamed to beecork-pipe".

**Agent side** (becomes `beecork`) — already named beecork internally, ~zero renaming:
6. Finish Phase 6 packaging (bin/shebang/build, README, LICENSE, CI) as `beecork`.
7. `mv /coding/cliagent /coding/beecork/beecork`.
8. `package.json`: name `beecork`, **version `2.0.0`** (above the old 1.7.1 to take the
   name cleanly), repo `beecork/beecork`.
9. GitHub: transfer `speudoname/beecorkcli` → `beecork/beecork` (after step 4).
10. npm: publish `beecork@2.0.0` (the agent).

**Brand:** `beecork-site` positions `beecork` = the coding agent (flagship),
`beecork-pipe` = the always-on infra.

## GitHub (verified 2026-06-26)

Org `beecork` repos: `beecork/beecork` (the pipe, **public**), `beecork/beecork-infra`
(private), `beecork/beecork-site` (private), `beecork/beecork-cloud` + `beecork/beecork-admin`
(both **archived** — already consolidated into `beecork-infra`). Agent: `speudoname/beecorkcli`
(private). **The user is an `admin` of the org → renames + transfers are doable by us.**

Repo moves (Phase B/C, outward — do after the local reorg):
- Rename `beecork/beecork` → `beecork/beecork-pipe` (GitHub auto-redirects the old URL).
- Rename `speudoname/beecorkcli` → `speudoname/beecork`, then transfer into the `beecork`
  org → **`beecork/beecork`** (after the pipe repo is renamed away). Make public at ship time.

## How we'll know it worked
`npm i -g beecork` installs the agent; `npm i -g beecork-pipe` installs the pipe; both
coexist with no `~/.beecork` collision; beecork.com shows the two products; repos sit
under the `beecork` org.

## Caveats for execution
Touches outward services (npm publish/deprecate, GitHub org repo rename + transfer) and
a *separate active project* (the pipe). Local/agent-side moves are safe to do; the npm +
GitHub-org steps and the pipe's config-dir migration need the user in the loop.
