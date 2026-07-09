// Live status line pinned to the terminal's bottom row: model · effort · git branch · ~tokens ·
// background tasks, refreshed on a timer. It reserves the last row with a DECSTBM scroll region so all
// normal output scrolls ABOVE it while the bar stays put. TTY-only; STATUSLINE=0 disables it.
//
// SAFETY: a shrunk scroll region left behind would break the user's shell, so stopStatusline() resets
// it and is SYNCHRONOUS (safe to call from a process 'exit' handler — wired that way in index.ts, so it
// runs on every exit path). Worst case if something glitches: a cosmetic artifact → STATUSLINE=0.

import { execFile } from "node:child_process";
import { config } from "./config";
import { state } from "./state";
import { color } from "./ui";
import { runningTaskCount } from "./tasks";

let active = false;
let drawTimer: ReturnType<typeof setInterval> | null = null;
let gitTimer: ReturnType<typeof setInterval> | null = null;
let branch = ""; // cached git branch (+"*" if dirty); refreshed async so we never block the draw
let tokensOf: (() => number) | null = null;

const rows = (): number => process.stdout.rows ?? 24;

// Refresh the cached branch/dirty marker off the draw path (git calls are too slow for a 2s timer hot path).
function pollGit(): void {
  execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 1500, windowsHide: true }, (err, out) => {
    if (err) { branch = ""; return; }
    const b = String(out).trim();
    execFile("git", ["status", "--porcelain"], { timeout: 1500, windowsHide: true }, (e2, out2) => {
      branch = b + (!e2 && String(out2).trim() ? "*" : "");
    });
  });
}

function segments(): string {
  const parts = [state.model.split("/").pop() ?? state.model, state.reasoningEffort];
  if (branch) parts.push(branch);
  if (tokensOf) parts.push(`~${Math.round(tokensOf() / 1000)}k`);
  const bg = runningTaskCount();
  if (bg > 0) parts.push(`${bg} task${bg === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function draw(): void {
  if (!active) return;
  // save cursor (DEC) → jump to the reserved bottom row (absolute, ignores the scroll region) → clear
  // it → write dim → restore the cursor. Atomic within one sync callback, so it never splits output.
  process.stdout.write(`\x1b7\x1b[${rows()};1H\x1b[2K${color.dim(segments())}\x1b8`);
}

function onResize(): void {
  if (!active) return;
  process.stdout.write(`\x1b[1;${rows() - 1}r`); // re-reserve on the new height
  draw();
}

// tokens: a getter for the current conversation size (kept out of this module so it stays decoupled).
export function startStatusline(tokens: () => number): void {
  if (active || !process.stdout.isTTY || !config.statuslineEnabled) return;
  active = true;
  tokensOf = tokens;
  // Reserve the bottom row (scroll region = rows 1..n-1). We deliberately DON'T move the cursor — it
  // stays right after the banner, so there's no gap; the bar self-separates from content on the first
  // scroll and is redrawn every refresh regardless.
  process.stdout.write(`\x1b[1;${rows() - 1}r`);
  pollGit();
  draw();
  drawTimer = setInterval(draw, config.statuslineRefreshMs);
  gitTimer = setInterval(pollGit, 5000);
  process.stdout.on("resize", onResize);
}

// SYNCHRONOUS reset — restore the full-screen scroll region + clear the bar row. Idempotent.
export function stopStatusline(): void {
  if (!active) return;
  active = false;
  if (drawTimer) clearInterval(drawTimer);
  if (gitTimer) clearInterval(gitTimer);
  process.stdout.removeListener("resize", onResize);
  process.stdout.write(`\x1b[r\x1b[${rows()};1H\x1b[2K`); // reset region, clear the bar
}
