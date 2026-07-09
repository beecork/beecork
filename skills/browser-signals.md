---
description: Set up / use the browser link so beecork sees the app's console + network errors (read_dev_signals)
---

# Browser signals — let beecork see the running app

You can read the user's app **console errors** and **failed network requests** straight
from the browser — on localhost *or* production, in their real logged-in session — with the
`read_dev_signals` tool. No copy-pasting errors. This is the **Beecork Skeleton** Chrome
extension plus a tiny local inbox (the "bridge").

## When to use `read_dev_signals`

Call it whenever the user reports something a browser would surface — a blank page, a broken
button, a form that won't submit, a save that 500s, a visual glitch. Instead of guessing, pull
the real errors:

- `read_dev_signals({ kind: "network" })` — failed requests (status ≥ 400 / network failures)
- `read_dev_signals({ since_minutes: 5 })` — everything captured in the last 5 minutes
- `read_dev_signals({})` — the most recent signals of any kind

Pull it **on demand** while debugging — don't call it in a loop or on every turn.

## Watching an on-demand / production site

Localhost/dev sites the user approved are watched automatically. A **production** (or
any "on-demand") approved site is idle until asked. To investigate one, call
`watch_site({ url })` — it asks the extension to watch that site for a while. Only sites
the user already approved are honored (beecork can't start watching a brand-new site on
its own). Then have the user reproduce the issue (or open the site) and call
`read_dev_signals`.

## If it says "not connected" — one-time setup

The tool returns setup steps when the bridge isn't running. Relay them to the user:

1. **Start the local inbox (bridge):** run `node bridge/server.mjs` in the `beecork-extension`
   folder and leave it running. It listens on `localhost:8317`.
2. **Load the extension:** Chrome → `chrome://extensions` → enable **Developer mode** →
   **Load unpacked** → select the `beecork-extension/extension` folder → pin the icon.
3. **Connect + approve:** click the icon (it auto-connects — no token to paste), tick
   **Capture enabled**, open the app in a tab, and click **Pair this site**.

Then call `read_dev_signals` again.

## Empty result

If it connects but returns nothing, the watched tab just hasn't hit the error yet. Either ask
the user to reproduce it, or open the app yourself to trigger it — e.g.
`open -a "Google Chrome" http://localhost:3000` (macOS) — then reproduce the action and call
`read_dev_signals` again.

## How it stays safe

- **Approved sites only** — nothing is watched except sites the user approved in the popup.
- **Secrets redacted in the browser** — tokens, API keys, passwords, and Authorization values
  are stripped *before* any signal leaves the tab, so they never reach the inbox.
- **Local + authenticated** — the inbox is `127.0.0.1` only, and only the extension can write to
  it (an automatic local token; a web page you visit cannot).
