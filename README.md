<p align="center">
  <img src="https://raw.githubusercontent.com/beecork/beecork/main/logos/horizontal.svg" alt="Beecork" width="400">
</p>

<p align="center">
  <strong>Claude Code, always on. Reachable from anywhere.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/beecork"><img src="https://img.shields.io/npm/v/beecork" alt="npm version"></a>
  <a href="https://github.com/beecork/beecork/actions"><img src="https://github.com/beecork/beecork/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/beecork" alt="License"></a>
</p>

---

Beecork is infrastructure for Claude Code. It gives Claude Code a phone number, a memory, and an alarm clock.

Message Claude Code from Telegram at 2am — it wakes up, does the work, messages you back. Or schedule it to wake itself up every Monday, check something, act on it, and go back to sleep. All without sitting at a terminal.

## What It Does

- **Messaging channels** — Telegram, WhatsApp, Discord. Send a message, get a response.
- **Virtual tabs** — Persistent Claude Code sessions with context that survives restarts.
- **Task scheduling** — Tell Claude Code to set up recurring tasks via MCP tools — it wakes up, runs the task, reports back.
- **Memory** — Cross-session memory so Claude Code never loses context.
- **MCP server** — 38 tools Claude Code can call to manage tabs, memory, cron jobs, watchers, media, folders, and more.
- **Smart routing** — Pipe brain routes messages to the right folder and tab, tracks goals, learns from your usage.
- **Background service** — Runs as a launchd (macOS), systemd (Linux), or Task Scheduler (Windows) service. Starts on login, runs silently.

## Quick Start

```bash
# Install
npm install -g beecork

# Interactive setup (Telegram token, Claude Code path, background service)
beecork setup

# Start
beecork start
```

Then message your Telegram bot. Claude Code handles the rest.

See [Getting Started](https://github.com/beecork/beecork/blob/main/docs/getting-started.md) for the full walkthrough.

## CLI

```bash
# Core
beecork start              # Start the daemon
beecork stop               # Stop the daemon
beecork status             # Check if running
beecork setup              # Set up Beecork (Telegram + system service)
beecork doctor             # Diagnose common issues
beecork update             # Update to latest version
beecork quickstart         # Print getting-started checklist

# Tabs & Messages
beecork tabs               # List active tabs
beecork send <msg>         # Send a message to the default tab
beecork logs               # Tail daemon logs
beecork export <tab>       # Export tab for terminal handoff
beecork attach <tab>       # Attach to a running tab

# Scheduling & Watchers
beecork tasks list         # List scheduled tasks
beecork tasks delete <id>  # Delete a task
beecork watches            # List active watchers
beecork watch delete <id>  # Delete a watcher

# Memory & Knowledge
beecork memory list        # List stored memories
beecork memory delete <id> # Delete a memory
beecork knowledge          # View stored knowledge

# Channels & Integrations
beecork discord            # Set up Discord bot
beecork whatsapp           # Set up WhatsApp
beecork webhook            # Set up webhook endpoint
beecork enable <cap>       # Enable a capability (github, notion, database)
beecork disable <cap>      # Disable a capability
beecork capabilities       # List available capabilities

# Tools
beecork dashboard          # Open the web dashboard
beecork mcp list           # List MCP server configs
beecork media setup        # Configure media generators
beecork activity           # View activity summary
beecork history            # Show activity timeline
beecork folders            # List discovered folders
beecork machines           # List registered machines
beecork templates          # List tab templates
beecork store search <q>   # Search community extensions
beecork store install <p>  # Install a community package
```

Tasks, watchers, and memories are created by Claude Code itself via MCP tools — just tell it what you need in natural language. The CLI is for viewing and managing them.

Run `beecork --help` for the full list of commands.

## Deploy Anywhere

| Setup | Best For |
|-------|----------|
| **Local machine** | Tasks that need local files, Xcode projects, local apps |
| **VPS** | Always-on — web scraping, monitoring, API calls, server management. Requires a full OS environment (Node.js, Claude Code CLI, system service). |
| **[Beecork Cloud](https://beecork.com/cloud)** | Zero setup — a full cloud computer with everything pre-configured. No terminal, no installation. |

Local install is `npm install -g beecork`. VPS requires the same plus a properly configured server environment. Beecork Cloud handles all of that for you.

## Architecture

```
Telegram/WhatsApp/Discord
        |
    Pipe Brain (intelligent routing)
        |
    Daemon (always-on)
        |
    TabManager
        |
    Claude Code subprocess (persistent sessions)
        |
    MCP Server <-> SQLite (memory, state)
```

## Community

- [Discord](https://discord.gg/wEM9avTzb) — Chat, ask questions, share what you've built
- [Twitter/X](https://x.com/BeecorkAI) — Updates, demos, announcements
- [GitHub Discussions](https://github.com/beecork/beecork/discussions) — Feature ideas, Q&A

## Documentation

- [Getting Started](https://github.com/beecork/beecork/blob/main/docs/getting-started.md) — Full setup walkthrough
- [Use Cases](https://github.com/beecork/beecork/blob/main/docs/use-cases.md) — What you can build with Beecork
- [Troubleshooting](https://github.com/beecork/beecork/blob/main/docs/troubleshooting.md) — Common issues and fixes
- [Comparison](https://github.com/beecork/beecork/blob/main/docs/comparison.md) — How Beecork compares to alternatives
- [Contributing](https://github.com/beecork/beecork/blob/main/CONTRIBUTING.md) — How to contribute
- [Security](https://github.com/beecork/beecork/blob/main/SECURITY.md) — Reporting vulnerabilities

## Requirements

- Node.js 18+
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Claude Pro or Max subscription
- Telegram account (for the bot)

## License

[MIT](https://github.com/beecork/beecork/blob/main/LICENSE)
