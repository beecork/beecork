# Beecork — Product Roadmap

## Phase 1: Core Product (DONE)
- [x] CLI: setup, start, stop, status, tabs, logs, cron, memory, send, update
- [x] Telegram integration (polling, emoji reactions, streaming, retry)
- [x] WhatsApp client (Baileys) — built, needs wiring into daemon
- [x] Virtual tabs with session persistence (--resume)
- [x] Cron system (at/every/cron schedules, missed fire detection)
- [x] Memory system (manual + auto-extraction, recall, context injection)
- [x] 10 MCP tools for Claude Code
- [x] Intelligent pipe brain (routing, goal tracking, learning)
- [x] Context window compaction (summarize + restart)
- [x] 3-tier loop detection (warn/notify/kill)
- [x] Crash recovery with auto-resume
- [x] launchd/systemd background service
- [x] 88 unit tests
- [x] npm package published (beecork)
- [x] Landing page (beecork.com)
- [x] Open source (github.com/beecork/beecork)

## Phase 2: WhatsApp + Hosted Platform (NOW)

### 2A. Wire WhatsApp into daemon (immediate)
- [ ] Add WhatsApp client startup in daemon.ts
- [ ] Setup wizard asks for WhatsApp config
- [ ] QR code scan flow during setup
- [ ] Test end-to-end: WhatsApp message → Claude Code → response

### 2B. Hosted Beecork on Hetzner (this month)
- [ ] Design multi-tenant architecture
  - Each user gets isolated container/VM
  - Shared Hetzner dedicated server (e.g., AX102 — 128GB RAM, 12 cores)
  - Docker containers per user with resource limits
  - User brings own Claude Pro/Max subscription (BYOK)
- [ ] Build provisioning system
  - API: create user → provision container → install beecork → return credentials
  - User dashboard: status, logs, restart, config
  - Auto-setup: user provides Telegram token → beecork setup runs automatically
- [ ] Billing
  - Stripe integration
  - Plans: $15/mo (basic), $25/mo (priority support + more resources)
  - Free trial: 7 days
- [ ] Landing page: beecork.com/cloud
- [ ] Infrastructure
  - Hetzner server provisioning
  - Docker Compose or Kubernetes for container management
  - Nginx reverse proxy for dashboard
  - SSL certificates
  - Monitoring (uptime, resource usage per container)
  - Automated backups of user data (~/.beecork/)

## Phase 3: Desktop App (Month 2)

### Electron app
- [ ] Menu bar icon (Mac tray / Windows system tray)
- [ ] Click to open: dashboard showing tabs, cron jobs, memories, logs
- [ ] Keyboard shortcut (Cmd+Shift+B) → text input popup
- [ ] Voice command via system microphone + Whisper API
- [ ] "Organize my desktop" → Beecork acts on local machine
- [ ] Auto-updater
- [ ] Drag-and-drop installer (DMG for Mac, EXE for Windows)
- [ ] No npm/terminal required — pure GUI setup

## Phase 4: Mobile App (Month 3)

### iPhone app (React Native or Swift)
- [ ] Native app replacing Telegram as primary interface
- [ ] Push notifications for task completion, cron results, errors
- [ ] Voice commands (press-and-hold to speak)
- [ ] Dashboard: tabs, cron jobs, memories
- [ ] Chat interface with streaming responses
- [ ] Settings: manage API keys, project paths, cron schedules
- [ ] App Store distribution

### Android app
- [ ] Same features as iPhone
- [ ] Google Play distribution

## Phase 5: Skill Marketplace (Month 4+)

- [ ] Pre-built configurations users can share/sell
  - "Gmail Manager" — email triage, auto-responses
  - "Server Monitor" — uptime checks, log analysis, alerts
  - "Code Reviewer" — PR reviews, security scanning
  - "Social Media Manager" — post scheduling, analytics
  - "Data Pipeline" — ETL, reporting, dashboards
- [ ] Marketplace on beecork.com
- [ ] Revenue share: 70% creator / 30% Beecork
- [ ] Rating and review system
- [ ] One-click install into user's Beecork instance

## Revenue Projections

| Phase | Revenue Model | Price | Target Users | Monthly Revenue |
|-------|--------------|-------|-------------|-----------------|
| 2B | Hosted instances | $15-25/mo | 50 users | $750-1,250 |
| 3 | Desktop app (freemium) | $0-10/mo | 200 users | $0-2,000 |
| 4 | Mobile app (freemium) | $0-5/mo | 500 users | $0-2,500 |
| 5 | Skill marketplace | 30% cut | 20 sellers | $500-2,000 |

## Technical Decisions

- **Hosted platform**: Docker containers on Hetzner dedicated servers
- **Desktop app**: Electron (cross-platform Mac/Windows/Linux)
- **Mobile app**: React Native (iOS + Android from one codebase) or Swift (iOS-first)
- **Billing**: Stripe
- **User auth**: Simple email + password, or OAuth (Google/GitHub)
- **Dashboard**: Web-based (accessible from desktop app and mobile app)
