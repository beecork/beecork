# Beecork — Developer Guide

## Publishing to npm

Beecork is published on npm as `beecork`. There is **no CI/CD** — publishing is manual.

**Pushing to GitHub does NOT update npm.** Users running `npm install -g beecork` get whatever version was last published.

### Release workflow

```bash
# 1. Bump version
npm version patch   # or minor/major

# 2. Build (runs automatically via prepublishOnly)
# 3. Publish
npm publish

# 4. Push the version commit + tag
git push && git push --tags
```

### When to publish

Publish after any code changes that affect runtime behavior (bug fixes, new features, security fixes). No need to publish for docs-only or test-only changes.

## Project Structure

- `src/` — TypeScript source (~102 files)
- `dist/` — Compiled JS (built via `npm run build`)
- `tests/unit/` — Vitest unit tests
- `templates/CLAUDE.md` — Template injected into `~/.claude/CLAUDE.md` during setup
- `audits/` — Code audit reports (gitignored)

## Key Commands

```bash
npm run build        # TypeScript compile
npm run dev:daemon   # Run daemon in dev mode (tsx)
npm test             # Run vitest
npm run lint         # ESLint
```

## Architecture

CLI (Commander) -> Daemon (always-on) -> TabManager -> ClaudeSubprocess
Channels (Telegram, WhatsApp) feed messages to tabs.
MCP server communicates with daemon via shared SQLite + signal files.
Pipe brain does intelligent routing via Anthropic API.

## Conventions

- All notifications go through `broadcastNotify()` in daemon.ts — never couple directly to a specific channel
- Tab name validation is centralized in `TabManager.ensureTab()` via `validateTabName()`
- Shared text utilities (chunkText, timeAgo, parseTabMessage) live in `src/util/text.ts`
- Version is read from package.json via `src/version.ts` — never hardcode version strings
- Config file (`~/.beecork/config.json`) is chmod 600 after write (contains API keys)
- MCP server uses a cached singleton DB connection — not per-call
