#!/bin/bash
# Beecork — Clean Uninstall Script
# Removes everything so you can test a fresh install experience

set -e

echo "=== Beecork Clean Uninstall ==="
echo ""

# 1. Stop the daemon if running
echo "[1/7] Stopping daemon..."
beecork stop 2>/dev/null || true

# 2. Remove launchd service (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.beecork.daemon.plist"
  if [ -f "$PLIST" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "  Removed launchd service"
  fi
fi

# 3. Remove systemd service (Linux)
if [[ "$OSTYPE" == "linux"* ]]; then
  SERVICE="$HOME/.config/systemd/user/beecork.service"
  if [ -f "$SERVICE" ]; then
    systemctl --user stop beecork 2>/dev/null || true
    systemctl --user disable beecork 2>/dev/null || true
    rm -f "$SERVICE"
    systemctl --user daemon-reload 2>/dev/null || true
    echo "  Removed systemd service"
  fi
fi

# 4. Uninstall npm package
echo "[2/7] Uninstalling npm package..."
npm uninstall -g beecork 2>/dev/null || true

# 5. Remove Beecork data directory
echo "[3/7] Removing ~/.beecork/..."
rm -rf "$HOME/.beecork"

# 6. Remove Beecork section from ~/.claude/CLAUDE.md
echo "[4/7] Cleaning ~/.claude/CLAUDE.md..."
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
  # Remove content between Beecork markers
  sed -i.bak '/<!-- BEECORK START -->/,/<!-- BEECORK END -->/d' "$CLAUDE_MD" 2>/dev/null || \
  sed -i '' '/<!-- BEECORK START -->/,/<!-- BEECORK END -->/d' "$CLAUDE_MD" 2>/dev/null || true
  rm -f "${CLAUDE_MD}.bak"
  echo "  Cleaned CLAUDE.md"
fi

# 7. Remove Beecork from MCP config
echo "[5/7] Cleaning ~/.claude/mcp-config.json..."
MCP_CONFIG="$HOME/.claude/mcp-config.json"
if [ -f "$MCP_CONFIG" ]; then
  # Use node to remove the beecork key from the JSON
  node -e "
    const fs = require('fs');
    try {
      const config = JSON.parse(fs.readFileSync('$MCP_CONFIG', 'utf8'));
      if (config.mcpServers && config.mcpServers.beecork) {
        delete config.mcpServers.beecork;
        fs.writeFileSync('$MCP_CONFIG', JSON.stringify(config, null, 2));
        console.log('  Removed beecork from MCP config');
      }
    } catch (e) {
      console.log('  Could not parse MCP config, skipping');
    }
  " 2>/dev/null || true
fi

# 6. Remove any leftover log files
echo "[6/7] Removing logs..."
rm -f /tmp/beecork-*.log 2>/dev/null || true

echo "[7/7] Done!"
echo ""
echo "Beecork is fully removed. To test a fresh install:"
echo ""
echo "  npm install -g beecork"
echo "  beecork setup"
echo "  beecork start"
echo ""
