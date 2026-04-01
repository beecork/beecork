# Changelog

All notable changes to Beecork are documented here.

## [1.3.0] — 2026-04-01

### Added
- Watchers — condition-based monitoring with automatic actions
- Knowledge base — `beecork knowledge` for stored knowledge across sessions
- Time machine — replay and inspect past sessions
- Community store — `beecork store` for browsing extensions
- Fast voice — optimized STT/TTS pipeline
- ESLint, CI pipeline, unit tests, type safety improvements
- Open-source documentation (CONTRIBUTING, CODE_OF_CONDUCT, SECURITY)

### Changed
- Renamed `cron` commands to `tasks` (backward-compatible aliases kept)

### Fixed
- 42 issues from comprehensive code audit
- 7 simplification fixes from code review

## [1.2.0] — 2026-03-31

### Added
- Computer use support — Claude can control mouse, keyboard, and screen via `beecork computer-use`
- Capability packs — `beecork enable email/calendar/github/notion/drive/web/database`
- Quick and full setup wizard modes

## [1.1.0] — 2026-03-31

### Added
- Media generation providers — DALL-E, Stable Diffusion, Runway, Kling, Veo, Nano Banana, Lyria, ElevenLabs Music, Recraft
- Smart project routing — auto-discovers git repos, routes messages to the right tab
- Channel setup in wizard and CLI
- Tool progress updates with escalating intervals
- Publish workflow for npm via GitHub Actions

### Removed
- Suno integration (no official API available)

## [1.0.0] — 2026-03-31

### Added
- Core daemon with always-on background service (launchd/systemd)
- Virtual tabs — persistent Claude Code sessions
- Telegram, WhatsApp, Discord, and webhook channels
- Pipe brain — intelligent message routing with goal tracking
- MCP server with 38 tools
- Task scheduling (cron, interval, one-time)
- Cross-session memory (global, project, tab scopes)
- Web dashboard
- Multi-machine awareness
- Multi-agent delegation
- Session handoff to terminal
- Community channel SDK
- Notifications (Pushover, ntfy, webhooks)
- Tab templates and system prompts
- Voice (STT via Whisper, TTS via OpenAI/ElevenLabs)
- `beecork doctor` diagnostics
- Interactive setup wizard

[1.3.0]: https://github.com/beecork/beecork/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/beecork/beecork/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/beecork/beecork/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/beecork/beecork/releases/tag/v1.0.0
