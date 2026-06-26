# Project memory / instruction files (CLAUDE.md-style)

_Brief for the beecork project (formerly "cliagent"). Status: ✅ IMPLEMENTED._

## Intention

Give the agent **persistent, folder-aware memory**: instruction files (like Claude Code's `CLAUDE.md`) that are loaded automatically based on which folder the agent runs in, and injected into the system prompt — so it picks up personal preferences and per-project conventions without being re-told every session.

## How it is now (verified)

- `src/index.ts:60-63` — `SYSTEM_PROMPT` embeds `${process.cwd()}` and `${process.platform}`. So the agent knows the **folder path** (a string) and the OS.
- It does **not** read any file from that folder for instructions/memory. No hierarchy, no config files, no `.claude/`-style folder.

## The real problem (one sentence)

The agent starts every session with zero project knowledge — it can't follow your conventions or remember anything about a project unless you re-type it each time.

**Who feels it:** the user (you), on every new session in any project. Re-explaining "use tabs / tests are in /spec / don't touch generated files" over and over.

## Proposed change

On startup, look for instruction files at known locations, read them, and append their contents to the system prompt under a clear header (e.g. "Project instructions"). Plain text/Markdown files the user edits by hand.

### Hierarchy decision (made): FULL — global + project + nested

- **Global** file in the user's home dir → personal prefs that apply everywhere ("be terse", "I use pnpm").
- **Project** file at the repo/project root → per-project conventions.
- **Nested** → walking up from the current folder, merge any files found in parent subfolders (monorepo sub-package rules).
- **Merge order:** global first, then project root, then nested (more specific = later = higher priority, appended last).

**Pros:** most powerful; matches Claude Code; handles monorepos. **Cons:** the nested up-the-tree walk is the most code and rarely matters for a personal agent — candidate to drop if it's not pulling weight.

## Decisions (resolved)

- **Agent name:** rename **cliagent → beecork** in file contents (package.json name/description, comments, docs). Directory name on disk is cosmetic — can rename separately/later.
- **Instruction file name:** `cork.md`.
- **Folder:** all project/folder-specific data lives in a `.beecork/` folder inside the project. Global lives in `~/.beecork/` and holds ONLY global things (global `cork.md`, global `settings.json`, future skills).
- **Memory + settings:** build both. `cork.md` (Markdown, injected into prompt) + `settings.json` (config: default model, always-allowed tools, etc.).
- **Hierarchy (FULL):** load + merge in order — global `~/.beecork/cork.md` → project `.beecork/cork.md` → nested `.beecork/cork.md` walking up from cwd (more specific = later = wins). Settings merge the same way, key-by-key.
- **Why this beats Claude Code's layout (user's call, agreed):** CC's CLAUDE.md is already project-local, but it ALSO stows per-project *session data* in the global `~/.claude/projects/<hash>/` — the confusing part. We co-locate ALL project/folder data in the project's `.beecork/`; global holds only global. Cleaner; project memory travels with the project.

## Resulting layout

```
~/.beecork/                 global (applies everywhere)
  cork.md                   personal prefs ("be terse", "I use pnpm")
  settings.json             global defaults
  (skills/ ...)             future

<project>/.beecork/         project-specific (and nested, walking up)
  cork.md                   project conventions (commit this)
  settings.json             project config
```

## Risks / new problems

- **Context cost** — these files ride in the system prompt on every request; a big memory file eats tokens (mitigated by our compaction, but keep files lean).
- **Precedence confusion** — if global and project conflict, the merge order must be clear and documented.
- **Stale/wrong memory** — a memory file that drifts from reality misleads the agent (same caveat as any docs).

## Decision & next step

**GO.** Build order (slowly, minimal deps):
1. **Rename** cliagent → beecork in file contents (package.json, comments, docs).
2. **`loadInstructions()`** — find + read global `~/.beecork/cork.md` + project + nested `.beecork/cork.md` (walking up from cwd), merge in order, append to the system prompt under a clear "Project instructions" header.
3. **`loadSettings()`** — merge `settings.json` files (global → project → nested), apply known keys (start with default model; later: always-allowed tools).
4. **Test** that a `.beecork/cork.md` actually changes behavior (e.g. a convention the agent then follows).

Caveat to revisit: the nested up-the-tree walk is the most code and rarely matters — drop if it isn't pulling weight. Future: where session history/logs live (likely `.beecork/`, gitignored).
