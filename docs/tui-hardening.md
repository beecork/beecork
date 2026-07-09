# TUI hardening pass

The terminal-UI layer (`chrome.ts`, `input.ts`, `ui.ts`) is the one part of beecork where the code is
genuinely fiddlier than the rest — raw ANSI, global cursor state, hand-rolled line editors. After the
pinned-chrome work landed, we did a focused audit and paid down the edge cases + fiddliness *before*
building more on top. This is the record. (Not deepcode-derived — internal quality work, so it does
not go in `addedfromdeecode.md`.)

## What shipped

**Cleanliness**

- **`src/ansi.ts` — named escape sequences.** Every cursor/screen control (`saveCursor`,
  `hideCursor`, `clearLine`, `moveTo`, `setRegion`, `reverse`, …) lives in one place instead of bare
  `\x1b[…` literals scattered across three files. `chrome.ts`, `input.ts`, `ui.ts`, `index.ts`,
  `commands.ts` all compose these now. SGR *colors* stay in `ui.color` (that's the color module's job);
  `ansi` is strictly cursor/screen control. Zero behavior change — the helpers emit identical bytes.
- **`src/layout.ts` — the fiddliest math, extracted + tested.** `rowColOf`, `inputLayout` (soft-wrap +
  cursor placement), `moveVertIndex` (multi-line up/down), and `windowStart` (single-row horizontal
  scroll) were pure functions buried in closures; now they're exported and covered by
  `layout.test.ts` (10 cases: wrapping, wide chars, multi-line, column clamping, edges).

**Edge cases fixed**

- **Multi-line paste into the pinned input no longer submits early.** The chrome editor now uses the
  same paste-burst detection as the classic editor: an Enter arriving mid-burst is a literal newline,
  not a submit. Pasted newlines show as a dim `⏎` in the one-row box; the submitted value keeps the
  real `\n`.
- **Paste is coalesced.** Per-character inserts no longer trigger O(N) absolute redraws — they flush
  once when the key burst drains. (A human's keystrokes are each their own burst → drawn ~8ms later.)
- **Window-grow no longer strands a ghost chrome band.** On resize-to-larger, the old pinned band
  (which held no conversation content) is erased before the chrome redraws at the new bottom.
- **Tiny terminals are safe.** The reserved-row calculations clamp to ≥1, so a ≤3-row terminal renders
  cramped instead of emitting an invalid negative-row escape.

**Documented limitation (not fixed)**

- **Grapheme width.** `displayWidth` is per-code-point, so ZWJ emoji (👨‍👩‍👧), flags (🇬🇪), and
  base+VS16 (❤️) mis-measure and can drift the input cursor. Acceptable for a dependency-free editor;
  the fix, if it ever matters, is `Intl.Segmenter`. Noted in `ui.ts`.

## Deliberately deferred

- **Unifying the two line editors** — they render on different models (absolute block cursor vs.
  relative multi-line reflow); both work, and a merge is high-risk for little gain.
- **History recall in the pinned input** (up/down only drives the menu there) — a feature gap, not a
  bug; revisit when shipping arrow-history + multi-line input.

## Verification

`npm run typecheck` · `npm test` (100 unit tests incl. the new `layout.test.ts`) · `npm run build`, plus
fake-TTY harnesses driving the real key handlers at the byte level: chromePick renders in the dropdown
and never moves the content cursor; paste-burst → newline-not-submit + coalesced render + `⏎` display +
real-`\n` submit; resize-grow clears the old band; the classic `readPrompt` still submits + shows its
slash menu.
