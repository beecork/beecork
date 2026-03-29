---
name: npmpublish
description: Commit changes, push to GitHub, and publish a new version to npm via GitHub Actions.
---

# /npmpublish — Publish Beecork to npm

Commit all changes, push to GitHub, bump the version, and trigger the npm publish workflow.

## Invocation

- `/npmpublish` — defaults to `patch` bump
- `/npmpublish minor` — minor version bump
- `/npmpublish major` — major version bump

## Steps

### Step 1: Check for changes

Run `git status` and `git diff --stat` to see what's changed.

If there are no changes (clean working tree), skip to Step 4 (trigger publish of current version). Ask the user if they want to proceed with just a version bump + publish.

### Step 2: Commit changes

Stage and commit all changes. Follow the repo's commit style by checking `git log --oneline -5`.

- Stage relevant files (avoid secrets, .env, etc.)
- Write a concise commit message summarizing the changes
- Do NOT use `--no-verify`

### Step 3: Push to GitHub

```bash
git push origin main
```

If push fails (e.g., behind remote), inform the user and stop.

### Step 4: Trigger the publish workflow

Parse the version bump type from the argument (default: `patch`). Valid values: `patch`, `minor`, `major`.

```bash
gh workflow run publish.yml -f version_bump=<type>
```

### Step 5: Monitor the workflow

Wait a few seconds, then check the workflow status:

```bash
gh run list --workflow=publish.yml --limit=1
```

Show the user:
- The workflow run URL
- Current status

Tell the user they can check progress with:
```
gh run watch
```

### Step 6: Summary

Show:
- What was committed (file count, short summary)
- What version bump was triggered (patch/minor/major)
- Link to the GitHub Actions run
- Remind: the new version will appear on npm once the workflow completes (~1-2 minutes)
