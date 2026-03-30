# Troubleshooting

## Common Issues

### "Claude Code not found"

Install Claude Code:
```bash
npm install -g @anthropic-ai/claude-code
```

Verify it works:
```bash
claude --version
```

### "Invalid Telegram token"

1. Check the token with BotFather: send `/mybots` to @BotFather
2. Make sure you copied the full token (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)
3. Revoke and create a new token if needed

### Daemon won't start

Run diagnostics:
```bash
beecork doctor
```

Check logs:
```bash
beecork logs
```

Check for stale PID file:
```bash
cat ~/.beecork/daemon.pid
# If the PID doesn't match a running process:
rm ~/.beecork/daemon.pid
beecork start
```

### Bot not responding

1. Check daemon is running: `beecork status`
2. Check Telegram token is valid: `beecork doctor`
3. Check your user ID is in the allowlist: look at `~/.beecork/config.json`
4. Check logs: `beecork logs`

### High costs

Check spending:
```bash
beecork status  # Shows cost summary
```

Set a budget limit in `~/.beecork/config.json`:
```json
{
  "claudeCode": {
    "maxBudgetUsd": 10.00
  }
}
```
