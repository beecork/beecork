# Getting Started with Beecork

Beecork makes Claude Code always-on and reachable from your phone via Telegram, WhatsApp, or Discord.

## Prerequisites

- Node.js 18+
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- A Claude Pro or Max subscription (for Claude Code)
- A Telegram account (for the bot)

## Setup

### 1. Install Beecork

```bash
npm install -g beecork
```

### 2. Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g., "My Beecork")
4. Choose a username ending in `bot` (e.g., `mybeecork_bot`)
5. Copy the API token BotFather gives you

### 3. Find Your Telegram User ID

1. Search for **@userinfobot** on Telegram
2. Send it any message
3. It will reply with your user ID (a number like `123456789`)

### 4. Run Setup

```bash
beecork setup
```

Follow the prompts to enter your bot token and user ID.

### 5. Start the Daemon

```bash
beecork start
```

### 6. Send a Message

Open your Telegram bot and send any message. Beecork will pass it to Claude Code and send the response back.

## Useful Commands

| Command | What it does |
|---------|-------------|
| `beecork status` | Check if daemon is running |
| `beecork tabs` | List active tabs |
| `beecork logs` | View daemon logs |
| `beecork doctor` | Run diagnostics |
| `beecork dashboard` | Open web dashboard |
| `beecork cron list` | View scheduled tasks |
| `beecork mcp list` | View MCP servers |

## Organizing Work with Tabs

Use `/tab name message` in Telegram to route work to named tabs:

- `/tab deploy push the latest changes` — works in a "deploy" tab
- `/tab research find info about X` — works in a "research" tab
- `/tabs` — see all active tabs
- `/stop deploy` — stop the deploy tab

Each tab has its own Claude Code session, working directory, and memory.
