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
`web_fetch` · `web_search` · `update_todos` · `remember`

### Slash commands

`/model` · `/key` · `/update` · `/context` · `/clear` · `/resume` · `/good` · `/bad` · `/help` · `Shift+Tab` (rotate mode) · `exit`

### Memory

beecork reads `cork.md` and `.beecork/memory.md` from `~/.beecork/` (your global,
authoritative memory) and from the project tree (project context). Sessions are saved
under `.beecork/sessions/` for `/resume`.

## Configuration reference

All variables are read from the real shell environment only (never a project file). The full set:

| Env var | Purpose | Default |
|---|---|---|
| `OPENROUTER_API_KEY` | OpenRouter API key (required) | — |
| `OPENROUTER_MODEL` | Model id | `deepseek/deepseek-v4-flash` |
| `BRAVE_API_KEY` | Brave Search key (for `web_search`) | — |
| `VERIFY_COMMAND` | Command auto-run after edits (e.g. `npm run typecheck`) | — |
| `AUTO_APPROVE` | Headless: skip approval prompts (out-of-root/risky shell are still hard-denied) | off |
| `NO_UPDATE_NOTIFIER` / `CI` | Disable the "update available" check | off |
| `MAX_STEPS` | Max tool steps per turn | `50` |
| `EXEC_TIMEOUT_MS` | `run_bash` timeout | `30000` |
| `WEB_TIMEOUT_MS` | `web_fetch` / `web_search` timeout | `20000` |
| `MAX_CONTEXT_TOKENS` | Compact the conversation above this | `128000` |

Other tunables (`KEEP_RECENT`, `MAX_TOOL_RESULT_CHARS`, `RETRY_ATTEMPTS`, `API_TIMEOUT_MS`, `SEARCH_*`, `VERIFY_TIMEOUT_MS`, `TRACE_FILE`) are defined in `src/config.ts`.

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
