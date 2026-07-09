// Pinned bottom "chrome" (on by default for TTYs; opt out with STATUSLINE=0): a persistent input line + a rich statusline are
// pinned to the terminal's bottom rows via a DECSTBM scroll region, so the conversation scrolls ABOVE
// them (Claude-Code style). The SAME input line is used at the prompt AND for mid-turn steering, so
// steering looks like normal input. Self-contained minimal line editor (the classic inline editor in
// input.ts stays the default). TTY-only. On exit the scroll region is reset (wired in index.ts).
//
// WHY a separate editor: retrofitting the inline editor's relative-cursor rendering into a fixed region
// is what caused the banner-loss/flicker bugs. Here the input is ONE row (long lines scroll
// horizontally) and everything is drawn with ABSOLUTE positioning against a fixed region — robust.

import { color, stripAnsi, stripControl, isPrintableCodePoint } from "./ui";
import { ansi } from "./ansi";
import { windowStart, windowEnd } from "./layout";
import { execFile } from "node:child_process";
import { state, nextMode, modeLabel } from "./state";
import { config } from "./config";
import { runningTaskCount } from "./tasks";
import { pushKeyHandler } from "./input";

const out = (s: string) => process.stdout.write(s);
const rows = () => process.stdout.rows ?? 24;
const cols = () => process.stdout.columns ?? 80;

interface Key { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }

let active = false;
let turnActive = false; // true while a turn runs: real cursor is parked in the scroll region for output
let buf = "";
let cur = 0;
interface MenuItem { name: string; desc: string }
let allItems: MenuItem[] = []; // slash commands + skills, for the live menu
let sel = 0;            // selected menu row
let menuHidden = false; // Esc hides the menu until the buffer changes
let menuH = 0;          // current menu height in rows (the scroll region grows to fit it)
let prevMenuH = 0;      // to clear rows the menu vacated when it shrinks
let lastRegionB = -1;   // only re-set the scroll region when its bottom actually changes
// A blocking picker (chromePick, used by /model, /effort, /resume) — rendered in the SAME dropdown so
// it never fights the scroll region like the inline selectMenu did.
let pickItems: { label: string; hint?: string; value: unknown }[] | null = null;
let pickSel = 0;
let pickTitle = "";
let pickResolve: ((v: unknown) => void) | null = null;
let branch = ""; // cached git branch (+"*" dirty)
let tokensOf: () => number = () => 0;
type LineResult = { type: "line"; value: string } | { type: "quit" };
let onResult: ((r: LineResult) => void) | null = null; // resolves the idle nextLine()
let onInterrupt: (() => void) | null = null; // Ctrl-C MID-TURN: abort the running turn
const steering: string[] = []; // mid-turn notes typed while a turn runs
let restoreKeys: (() => void) | null = null;
let gitTimer: ReturnType<typeof setInterval> | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let lastRows = 0; // terminal height at the last render — to erase the stale chrome band after a GROW
// Paste-burst detection (mirrors the classic editor): a paste arrives as a rapid key burst, so an
// Enter mid-burst is a literal newline, not a submit; and per-char inserts coalesce into one redraw.
const BURST_IDLE_MS = 8;
let burstLen = 0;
let burstTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRender = false; // a render coalesced to the end of the current burst

// Four reserved rows: a top border, the input line (boxed between the borders), a bottom border, and
// the statusline. Region = 1..rows-4. FIXED height → robust. Rows are clamped to ≥1 so a tiny
// terminal can never make us emit an invalid negative-row escape (it just renders cramped).
const statusRow = () => Math.max(1, rows());
const borderBottomRow = () => Math.max(1, rows() - 1);
const inputRow = () => Math.max(1, rows() - 2);
const borderTopRow = () => Math.max(1, rows() - 3);
const mark = () => color.green("› "); // "› " input marker
const PW = 2; // display width of the marker

// --- rich, colorful statusline (with MODE) ----------------------------------
function modeSegment(): string {
  // Label text is owned by modeLabel() (single source of truth); this only maps mode → color.
  const paint = state.mode === "auto" ? color.yellow : state.mode === "normal" ? color.green : color.cyan;
  return paint(modeLabel(state.mode));
}
export function statusText(): string { // exported for the sanitization regression test
  // stripControl: state.model can come from a lower-trust project settings.json, and branch from git —
  // both are repo-influenced; sanitize before printing so they can't emit cursor/escape/OSC sequences.
  const model = stripControl(state.model.split("/").pop() ?? state.model);
  const tok = tokensOf();
  const ctxK = Math.round(config.maxContextTokens / 1000);
  const parts = [
    modeSegment(),
    color.cyan(model),
    color.dim(state.reasoningEffort),
    ...(branch ? [color.green(stripControl(branch))] : []),
    color.dim(`~${Math.round(tok / 1000)}k/${ctxK}k`),
  ];
  const bg = runningTaskCount();
  if (bg > 0) parts.push(color.yellow(`${bg} task${bg === 1 ? "" : "s"}`));
  return parts.join(color.dim(" · "));
}
function pollGit(): void {
  execFile("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 1500, windowsHide: true }, (err, o) => {
    if (err) { branch = ""; return; }
    const b = String(o).trim();
    execFile("git", ["status", "--porcelain"], { timeout: 1500, windowsHide: true }, (e2, o2) => {
      branch = b + (!e2 && String(o2).trim() ? "*" : "");
    });
  });
}

// --- rendering (absolute; wrapped in save/restore while a turn owns the cursor) ---
function drawStatus(): void {
  const s = statusText();
  // truncate to terminal width so it never wraps into the input row
  const vis = stripAnsi(s);
  out(ansi.moveTo(statusRow()) + ansi.clearLine + (vis.length <= cols() ? s : stripAnsi(s).slice(0, cols() - 1)));
}
function drawBorder(row: number): void {
  out(ansi.moveTo(row) + ansi.clearLine + color.dim("─".repeat(Math.max(1, cols()))));
}
const closePick = () => { pickItems = null; pickSel = 0; pickTitle = ""; };
// Blocking chooser rendered IN the chrome's dropdown (not the inline selectMenu, which fought the
// scroll region and orphaned the cursor). Used by /model, /effort, /resume in chrome mode. Resolves
// with the chosen item's value, or null if cancelled (Esc/Ctrl-C).
export function chromePick(items: { label: string; hint?: string; value: unknown }[], initial = 0, title = ""): Promise<unknown> {
  return new Promise((resolve) => {
    if (!active || !items.length) { resolve(null); return; }
    pickItems = items; pickSel = Math.min(Math.max(0, initial), items.length - 1); pickTitle = title; pickResolve = resolve;
    render();
  });
}
// Collapse newlines (from a multi-line paste) to a single-width glyph so the one-row input box never
// wraps. 1 code unit → 1 code unit, so buffer indices (cur, windowStart) stay aligned. The submitted
// value keeps the real "\n".
const flat = (s: string) => s.replace(/\n/g, "⏎");
// Draw the input with a REVERSE-VIDEO block as the cursor (the real terminal cursor stays at the
// content position, so output never leaves a gap). Empty → dim placeholder hint.
function drawInput(): void {
  const disp = flat(buf);
  const avail = Math.max(1, cols() - PW);
  const start = windowStart(disp, cur, avail);
  const shown = disp.slice(start, windowEnd(disp, start, avail)); // clip BOTH edges so the one row can't wrap
  const ci = cur - start;
  let body: string;
  if (!buf) {
    body = ansi.reverse + " " + ansi.reverseOff + color.dim("type a message · / for commands · Shift+Tab mode");
  } else {
    const at = ci < shown.length ? shown[ci] : " ";
    body = shown.slice(0, ci) + ansi.reverse + at + ansi.reverseOff + (ci < shown.length ? shown.slice(ci + 1) : "");
  }
  out(ansi.moveTo(inputRow()) + ansi.clearLine + mark() + body);
}
// The live slash-command menu: shown while the buffer is a bare "/word" (no space yet), unless Esc-hidden.
function currentMenu(): MenuItem[] {
  if (menuHidden || turnActive) return [];
  const m = buf.match(/^\/(\S*)$/);
  if (!m) return [];
  const pre = "/" + m[1];
  return allItems.filter((c) => c.name.startsWith(pre)).slice(0, 8);
}

// Redraw the chrome WITHOUT moving the real (content) cursor — save it (\x1b7), draw everything at
// absolute positions, restore it (\x1b8). The input's cursor is a drawn reverse-video block, so the
// terminal cursor stays parked right after the last conversation line — output never leaves a gap.
// The dropdown (slash menu OR a chromePick picker) pops ABOVE the box, growing the reserved region.
function render(): void {
  if (!active) return;
  // The dropdown shows EITHER a blocking picker (chromePick: /model, /effort, /resume) OR the live
  // slash-command menu. A picker replaces the input line with a "↑/↓ · Enter · Esc" hint.
  const picker = pickItems;
  const list = picker
    ? picker.slice(0, 12).map((it, i) => ({ text: it.label + (it.hint ? "  " + color.dim(it.hint) : ""), on: i === pickSel }))
    : currentMenu().map((it, i) => ({ text: it.name.padEnd(12) + " " + it.desc, on: i === sel }));
  if (!picker && sel >= list.length) sel = Math.max(0, list.length - 1);
  menuH = list.length;
  out(ansi.hideCursor + ansi.saveCursor); // hide + save the content cursor
  const regionB = Math.max(1, rows() - 4 - menuH);
  if (regionB !== lastRegionB) { out(ansi.setRegion(1, regionB)); lastRegionB = regionB; } // re-reserve only on change
  for (let r = borderTopRow() - prevMenuH; r < borderTopRow() - menuH; r++) out(ansi.moveTo(r) + ansi.clearLine); // clear vacated menu rows
  prevMenuH = menuH;
  const base = borderTopRow() - menuH;
  for (let i = 0; i < list.length; i++) {
    out(ansi.moveTo(base + i) + ansi.clearLine + (list[i].on ? color.green("› ") + list[i].text : color.dim("  ") + list[i].text));
  }
  drawBorder(borderTopRow());
  if (picker) out(ansi.moveTo(inputRow()) + ansi.clearLine + mark() + color.dim(pickTitle || "↑/↓ to choose · Enter to select · Esc to cancel"));
  else drawInput();
  drawBorder(borderBottomRow());
  drawStatus();
  out(ansi.restoreCursor); // restore the content cursor
  lastRows = rows();
  pendingRender = false; // any explicit render satisfies a coalesced-paste flush
}

function onResize(): void {
  if (!active) return;
  const newRows = rows();
  if (lastRows > 0 && newRows > lastRows) {
    // Window GREW: the terminal keeps the old chrome band drawn where it was — now stranded mid-screen
    // (that band held no conversation content). Erase it before redrawing the chrome at the new bottom.
    out(ansi.saveCursor);
    const oldTop = Math.max(1, lastRows - 3 - prevMenuH);
    for (let r = oldTop; r <= lastRows; r++) out(ansi.moveTo(r) + ansi.clearLine);
    out(ansi.restoreCursor);
  }
  lastRegionB = -1; // force the scroll region to be re-set for the new height
  render();
}

// Public: refresh just the statusline (timer / on demand), cursor-safe.
export function refreshChrome(): void {
  if (!active) return;
  out(ansi.hideCursor + ansi.saveCursor); // hide + save content cursor
  drawStatus();
  out(ansi.restoreCursor);
}

const edited = () => { menuHidden = false; sel = 0; }; // typing/deleting un-hides the menu + resets selection
// Insert text at the cursor. The redraw is COALESCED (flushed when the key burst drains) so a big
// paste is one redraw, not O(N). A human's keystrokes are each their own burst → drawn ~8ms later.
function insert(s: string): void {
  buf = buf.slice(0, cur) + s + buf.slice(cur);
  cur += s.length;
  edited();
  pendingRender = true;
}
function resetBurst(): void {
  if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
  burstLen = 0;
  pendingRender = false;
}
function onKey(str: string | undefined, key: Key | undefined): void {
  // Picker mode (chromePick): the dropdown is a blocking chooser — arrows move, Enter selects, Esc/Ctrl-C cancels.
  if (pickItems) {
    const n = pickItems.length;
    if (key?.name === "up") { pickSel = (pickSel - 1 + n) % n; render(); return; }
    if (key?.name === "down") { pickSel = (pickSel + 1) % n; render(); return; }
    if (key?.name === "return" || key?.name === "enter") { const v = pickItems[pickSel].value; closePick(); render(); pickResolve?.(v); pickResolve = null; return; }
    if (key?.name === "escape" || (key?.ctrl && key.name === "c")) { closePick(); render(); pickResolve?.(null); pickResolve = null; return; }
    return; // swallow everything else while picking
  }
  // Track the key burst; after BURST_IDLE_MS of quiet, reset the count and flush any coalesced render.
  // Re-arming on each key makes one burst span the multiple stdin chunks a paste arrives in.
  burstLen++;
  if (burstTimer) clearTimeout(burstTimer);
  burstTimer = setTimeout(() => { burstTimer = null; burstLen = 0; if (pendingRender) render(); }, BURST_IDLE_MS);
  const mm = currentMenu();
  if (key?.ctrl && key.name === "c") {
    if (buf) { buf = ""; cur = 0; edited(); resetBurst(); render(); return; } // first Ctrl-C clears the line
    if (turnActive) onInterrupt?.();                             // mid-turn → abort the turn
    else { const r = onResult; onResult = null; r?.({ type: "quit" }); } // idle → quit
    return;
  }
  if (key?.name === "escape") { // close the menu if open, else clear the line
    if (mm.length) { menuHidden = true; render(); }
    else if (buf) { buf = ""; cur = 0; render(); }
    return;
  }
  if (key?.name === "tab" && key.shift) { state.mode = nextMode(state.mode); render(); return; }
  if (key?.name === "tab") { // complete to the selected menu item
    if (mm.length) { buf = mm[sel].name + " "; cur = buf.length; edited(); render(); }
    return;
  }
  if (key?.name === "up") { if (mm.length) { sel = (sel - 1 + mm.length) % mm.length; render(); } return; }
  if (key?.name === "down") { if (mm.length) { sel = (sel + 1) % mm.length; render(); } return; }
  if (key?.name === "return" || key?.name === "enter") {
    // A newline mid-burst (a multi-line PASTE) or an explicit Shift/Alt+Enter is a literal newline,
    // not a submit — so pasted text isn't split across submissions. A lone Enter submits.
    if (key?.shift || key?.meta || burstLen > 1) { insert("\n"); return; }
    resetBurst();
    const line = buf;
    buf = ""; cur = 0; edited();
    render(); // menu gone → region shrinks; the content cursor is restored to the right spot
    if (turnActive) { if (line.trim()) steering.push(line.trim()); return; }
    if (line.trim()) out("\n" + mark() + line + "\n"); // echo AT the content cursor (no reposition → no gap)
    const r = onResult; onResult = null; r?.({ type: "line", value: line });
    return;
  }
  if (key?.name === "backspace") { if (cur > 0) { buf = buf.slice(0, cur - 1) + buf.slice(cur); cur--; edited(); render(); } return; }
  if (key?.name === "delete") { if (cur < buf.length) { buf = buf.slice(0, cur) + buf.slice(cur + 1); edited(); render(); } return; }
  if (key?.name === "left") { if (cur > 0) { cur--; render(); } return; }
  if (key?.name === "right") { if (cur < buf.length) { cur++; render(); } return; }
  if (key && (key.name === "home" || (key.ctrl && key.name === "a"))) { cur = 0; render(); return; }
  if (key && (key.name === "end" || (key.ctrl && key.name === "e"))) { cur = buf.length; render(); return; }
  if (key?.ctrl && key.name === "u") { buf = buf.slice(cur); cur = 0; edited(); render(); return; }
  if (str && !key?.ctrl && !key?.meta && [...str].length === 1 && isPrintableCodePoint(str.codePointAt(0)!)) {
    insert(str); // coalesced redraw (see insert)
  }
}

// Turn on the pinned chrome: reserve the bottom two rows, draw, start timers, own the keyboard.
export function startChrome(opts: { tokens: () => number; items: MenuItem[]; onInterrupt: () => void }): void {
  if (active || !process.stdout.isTTY) return;
  active = true;
  tokensOf = opts.tokens;
  allItems = opts.items;
  onInterrupt = opts.onInterrupt;
  out(ansi.bracketedPasteOff); // Apple Terminal draws visible [ ] brackets otherwise
  pollGit();
  restoreKeys = pushKeyHandler(onKey);
  render(); // reserves the scroll region, draws the chrome, positions the cursor
  statusTimer = setInterval(refreshChrome, config.statuslineRefreshMs);
  gitTimer = setInterval(pollGit, 5000);
  process.stdout.on("resize", onResize);
}

// Wait for the user to submit a line at the prompt (idle). Resolves with the line (or null on quit
// via Ctrl-C, surfaced through onInterrupt setting a flag — here we just resolve on submit).
export function nextLine(): Promise<LineResult> {
  return new Promise((resolve) => {
    turnActive = false;
    render(); // cursor into the input line
    onResult = resolve;
  });
}

// A turn is starting: park the real cursor in the scroll region so streamed output scrolls there, and
// switch the input line into steering mode. Returns the live steering queue (drained by runTurn).
export function beginTurn(): string[] {
  steering.length = 0;
  turnActive = true;
  return steering; // turn output flows at the content cursor (right after the echo); the region scrolls it
}
export function endTurn(): void {
  turnActive = false;
  render();
}

// Reset the scroll region + clear the chrome. SYNCHRONOUS (safe from an 'exit' handler).
export function stopChrome(): void {
  if (!active) return;
  active = false;
  restoreKeys?.(); restoreKeys = null;
  process.stdout.removeListener("resize", onResize);
  if (statusTimer) clearInterval(statusTimer);
  if (gitTimer) clearInterval(gitTimer);
  resetBurst(); // drop any pending paste-flush timer so it can't fire / keep the loop alive after exit
  out(ansi.resetRegion);
  for (const r of [statusRow(), borderBottomRow(), inputRow(), borderTopRow()]) out(ansi.moveTo(r) + ansi.clearLine); // clear chrome rows
}

export const chromeEnabled = (): boolean => config.statuslineEnabled && !!process.stdout.isTTY;
