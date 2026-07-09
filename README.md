<p align="center">
  <strong>🐝 beecork</strong>
</p>

<p align="center">
  <strong>A from-scratch CLI coding agent — multi-model, BYOK, path-confined.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/beecork"><img src="https://img.shields.io/npm/v/beecork" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/beecork" alt="License"></a>
</p>

---

beecork is a small, transparent coding agent you run in your terminal. It talks to
any model on [OpenRouter](https://openrouter.ai) (bring your own key), works inside
the directory you launch it from, and asks before doing anything outside that root.

> **Two products, one brand.** This is `beecork`, the coding agent. The always-on
> Claude Code infrastructure (channels, memory, cron) is now
> [`beecork-pipe`](https://www.npmjs.com/package/beecork-pipe).

## Install

```bash
npm install -g beecork
```

Requires Node.js >= 20.12.

## Setup (BYOK)

beecork reads its config from the shell environment or `~/.beecork/config.json`. A project's
own `.env` is intentionally **not** read — beecork runs inside arbitrary (possibly cloned)
projects, so your key is never picked up from whatever `.env` happens to sit in the working dir.

```bash
export OPENROUTER_API_KEY=sk-or-...      # required
export OPENROUTER_MODEL=...              # optional (default: deepseek/deepseek-v4-flash)
export BRAVE_API_KEY=...                 # optional — only web_search needs it
```

On first run, if no key is found, beecork prompts for one (entry is masked and stored
chmod-600 in `~/.beecork/config.json`).

## Usage

```bash
cd your-project
beecork
```

Then just talk to it. Each message becomes one agentic turn. The project root is the
directory you launched in — file tools are confined to it, and anything that reaches
outside (or any shell command) goes through a permission gate.

### Tools

`read_file` · `show` · `write_file` · `edit_file` · `list_dir` · `search` · `run_bash` ·
`web_fetch` · `web_search` · `update_todos` · `remember` · `read_skill` · `ask_user` · `check_task` · `stop_task` · `explore`

### Background tasks

`run_bash` can run a command **in the background** (dev servers, watchers, long builds): the agent gets
a task id immediately and polls it with `check_task` / stops it with `stop_task`. Background tasks stay
up across turns and are all killed when beecork exits.

### Mid-turn steering

While the agent is working, just **type a message and press Enter** — it's queued and picked up on the
next step, without cancelling the turn ("also update the README", "no, use pnpm"). Ctrl-C still cancels.

### Sub-agents (`explore`)

The agent can delegate an open-ended investigation to a **read-only sub-agent** that explores on its own
(reading, searching, browsing the web) in a separate context and returns just a summary — keeping the
main conversation clean. It cannot modify anything, run commands, or recurse.

### Pinned UI + status line

On an interactive terminal, beecork pins a persistent input box and a rich status line
(`mode · model · effort · git branch · ~tokens · background tasks`) to the bottom, with the
conversation scrolling above (Claude-Code style). Shift+Tab rotates the mode. This is **on by default**;
opt out with `STATUSLINE=0` to use the classic inline editor. Piped/non-TTY input is unaffected either way.

### Modes

Shift+Tab cycles four permission modes: **normal** (ask before each edit/command) → **auto-approve**
(auto-approve edits & commands; the hard guard for out-of-root/risky shell still asks) → **read-only**
(block all mutation — explore with reads/search only) → **plan** (read-only for mutations, but
provably-safe read-only shell like `git log`/`grep` is allowed, so the agent can investigate and present
a plan; flip back to normal to execute it). Provably-safe read-only shell commands (`ls`, `cat`,
`git status`…) auto-run without a prompt in normal mode — opt out with `SAFE_BASH_APPROVE=0`.

### Skipping permissions (danger)

For **disposable sandboxes / CI only**, `beecork --dangerously-skip-permissions` (or
`BEECORK_DANGEROUSLY_SKIP_PERMISSIONS=1`) turns off the approval gate — out-of-root paths and risky
shell run unprompted, with a red warning. Two floors still hold: an explicit read-only mode still blocks
writes, and catastrophic commands (`rm -rf /`, fork bombs, `mkfs`, …) are still refused.

### Slash commands

`/model` · `/effort` · `/key` · `/update` · `/context` · `/clear` · `/resume` · `/good` · `/bad` · `/help` · `Shift+Tab` (rotate mode) · `exit`

### Reasoning ("thinking")

For models that support it, beecork can ask the model to reason before answering. Set the depth
with `/effort <off|low|medium|high|max>` (persists across restarts) or the `REASONING_EFFORT` env
var; default is `medium`. It uses OpenRouter's unified `reasoning` parameter, so it works across
every provider (deepseek, GLM, Gemini, Claude, OpenAI, …), and is only sent to models that advertise
support. The thinking streams dimly, distinct from the answer. Note: reasoning tokens bill as output
tokens.

### Memory

beecork reads `cork.md` and `.beecork/memory.md` from `~/.beecork/` (your global,
authoritative memory) and from the project tree (project context). It also reads the
cross-tool standard **`AGENTS.md`** (and `CLAUDE.md`) if a repo ships one, as lower-trust
project instructions — so beecork "just works" in repos set up for other agents. Sessions
are saved under `.beecork/sessions/` for `/resume`.

## Configuration reference

All variables are read from the real shell environment only (never a project file). The full set:

| Env var | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key (required) | — |
| `OPENROUTER_MODEL` | Model id | `deepseek/deepseek-v4-flash` |
| `REASONING_EFFORT` | Reasoning depth: `off`/`low`/`medium`/`high`/`max` | `medium` |
| `OPENROUTER_EXTRA` | Advanced: JSON of extra request-body params (`temperature`, `seed`, provider routing, …) | — |
| `BRAVE_API_KEY` | Brave Search key (for `web_search`) | — |
| `VERIFY_COMMAND` | Command auto-run after edits (e.g. `npm run typecheck`) | — |
| `AUTO_APPROVE` | Headless: skip approval prompts (out-of-root/risky shell are still hard-denied) | off |
| `SAFE_BASH_APPROVE` | Auto-approve provably-safe read-only shell (`ls`/`cat`/`git status`…); set `0` to prompt for all | on |
| `BEECORK_DANGEROUSLY_SKIP_PERMISSIONS` | Sandbox-only: skip the whole gate (also `--dangerously-skip-permissions`) | off |
| `STATUSLINE` / `STATUSLINE_REFRESH_MS` | Pinned UI + status bar (set `0` to opt out) · refresh interval | on · `2000` |
| `NO_UPDATE_NOTIFIER` / `CI` | Disable the "update available" check | off |
| `MAX_STEPS` | Max tool steps per turn | `50` |
| `EXEC_TIMEOUT_MS` | `run_bash` timeout | `30000` |
| `WEB_TIMEOUT_MS` | `web_fetch` / `web_search` timeout | `20000` |
| `MAX_CONTEXT_TOKENS` | Compact the conversation above this | `128000` |

Other tunables (`KEEP_RECENT`, `MAX_TOOL_RESULT_CHARS`, `RETRY_ATTEMPTS`, `API_TIMEOUT_MS`, `SEARCH_*`, `VERIFY_TIMEOUT_MS`, `TRACE_FILE`, `MAX_BG_TASKS`, `BG_TAIL_CHARS`, `SUBAGENT_MAX_STEPS`, `MEMORY_MAX_CHARS`, `MEMORY_NUDGE_INTERVAL`, `SAFE_BASH_APPROVE`) are defined in `src/config.ts`.

## Development

```bash
npm run dev         # run from source (tsx)
npm run typecheck   # tsc --noEmit
npm test            # unit tests
npm run build       # bundle to dist/index.js (esbuild)
npm run eval        # run the eval harness
```

## License

[MIT](LICENSE) © Beecork
