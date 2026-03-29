#!/bin/bash
# Beecork installer — https://beecork.com
set -e

echo ""
echo "  🐝 Installing Beecork..."
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
  echo "  ❌ Node.js is required but not installed."
  echo "     Install it from https://nodejs.org (v18+)"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "  ❌ Node.js v18+ required. You have $(node -v)"
  exit 1
fi

# Check for Claude Code
if ! command -v claude &> /dev/null; then
  echo "  ⚠️  Claude Code CLI not found."
  echo "     Install it from https://claude.ai/code"
  echo "     Beecork requires Claude Code to function."
  echo ""
fi

# Install beecork
echo "  📦 Installing from npm..."
npm install -g beecork

echo ""
echo "  ✅ Beecork installed!"
echo ""
echo "  Next steps:"
echo "    beecork setup    — Configure Telegram, Claude Code path"
echo "    beecork start    — Start the daemon"
echo ""
echo "  Docs: https://beecork.com"
echo "  GitHub: https://github.com/beecork/beecork"
echo ""
