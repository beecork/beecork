// Terminal presentation: colors, the startup banner, and small renderers.

import { tildify } from "./paths";
import { lineDiff } from "./diff";
import type { TodoItem } from "./types";

// --- Colors -----------------------------------------------------------------
// Color only when attached to a real terminal. Override with NO_COLOR / FORCE_COLOR.
const useColor = process.env.NO_COLOR ? false : process.env.FORCE_COLOR ? true : Boolean(process.stdout.isTTY);
const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const color = {
  cyan: paint("36"),
  green: paint("32"),
  yellow: paint("33"),
  red: paint("31"),
  dim: paint("2"),
  bold: paint("1"),
  italic: paint("3"),
  strike: paint("9"),
  brand: (s: string) => (useColor ? `\x1b[38;2;40;158;116m${s}\x1b[0m` : s), // softened logo green
};

// Strip control bytes from model/repo-controlled text before printing it, so it can't
// emit cursor moves / screen clears / OSC sequences and spoof the approval prompt or a
// rendered view. Keeps TAB (\t) and NEWLINE (\n); strips ESC, CR, the rest of C0, C1,
// and DEL. The RAW value is always kept for the actual fs/exec call.
// A printable, safe code point: >= 0x20, not DEL (0x7f), not a C1 control (0x80-0x9f).
// The one place this rule lives — shared by stripControl (output) and the input editor (keystrokes).
export const isPrintableCodePoint = (c: number) => c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f);

export function stripControl(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c === 9 || c === 10 || isPrintableCodePoint(c)) out += ch; // keep TAB/NEWLINE too
  }
  return out;
}

// Strip SGR color escapes — used to measure the VISIBLE width of a colored string.
export const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Approximate terminal display columns of a code point: combining/zero-width = 0, East-Asian
// Wide/Fullwidth + most emoji = 2, everything else = 1. Dependency-free (no wcwidth table file);
// good enough for cursor placement. Used by displayWidth.
function charWidth(cp: number): number {
  if (cp === 0) return 0;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff ||
      (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0xfe20 && cp <= 0xfe2f)) return 0; // combining/zero-width
  if (
    (cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd) // emoji + CJK Ext B+
  ) return 2;
  return 1;
}
// Display width of a (control-free) string in terminal columns, counting code points.
export const displayWidth = (s: string): number => {
  let w = 0;
  for (const ch of s) w += charWidth(ch.codePointAt(0)!);
  return w;
};

// --- Todo list rendering ----------------------------------------------------
export function renderTodos(items: TodoItem[]): string {
  if (items.length === 0) return "(todo list empty)";
  return items
    .map((t) => `${t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]"} ${t.content}`)
    .join("\n");
}

// --- Tool activity: readable call lines + concise result summaries ----------
// Replaces dumping raw JSON. The call line prints before the tool runs; the
// summary (summarizeResult) completes the same line afterwards, e.g.
//   edit   src/api.ts  ·  +2 −1
//   $ npm run typecheck  ·  ✓ 14 lines
const VERB_W = 7; // pad the verb column so targets line up

export function renderToolCall(name: string, a: Record<string, any>): string {
  const verb = (v: string, paint: (s: string) => string) => paint(v.padEnd(VERB_W));
  const sc = (x: any) => stripControl(String(x ?? "")); // model-controlled — strip escapes
  switch (name) {
    case "read_file":
      return verb("read", color.cyan) + sc(a.path) +
        (a.offset ? color.dim(`  :${a.offset}${a.limit ? `+${a.limit}` : ""}`) : "");
    case "show":
      return verb("show", color.cyan) + sc(a.path);
    case "list_dir":
      return verb("list", color.cyan) + sc(a.path ?? ".");
    case "search":
      return verb("search", color.cyan) + color.dim(`"${sc(a.pattern)}"`) +
        (a.path ? color.dim(`  in ${sc(a.path)}`) : "");
    case "write_file":
      return verb("write", color.yellow) + sc(a.path);
    case "edit_file":
      return verb("edit", color.yellow) + sc(a.path);
    case "run_bash":
      return color.yellow("$ ") + sc(a.command);
    case "web_fetch":
      return verb("fetch", color.cyan) + sc(a.url);
    case "web_search":
      return verb("web", color.cyan) + color.dim(`"${sc(a.query)}"`);
    case "remember":
      return verb("note", color.cyan) + color.dim(sc(a.fact));
    case "update_todos":
      return color.cyan("plan");
    default:
      return color.dim(name);
  }
}

function diffCounts(oldText: string, newText: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of lineDiff(oldText, newText).split("\n")) {
    if (l.startsWith("+")) added++;
    else if (l.startsWith("-")) removed++;
  }
  return { added, removed };
}

const DIFF_PREVIEW_LINES = 40; // approval diff is capped to this many lines on screen
// Render a diff with colored +/- lines, capped so a huge change can't flood the approval screen.
export function diffPreview(diff: string): string {
  const lines = diff.split("\n");
  const shown = lines
    .slice(0, DIFF_PREVIEW_LINES)
    .map((l) => (l.startsWith("+") ? color.green(l) : l.startsWith("-") ? color.red(l) : color.dim(l)));
  if (lines.length > DIFF_PREVIEW_LINES) shown.push(color.dim(`(${lines.length - DIFF_PREVIEW_LINES} more lines)`));
  return shown.map((l) => "   " + l).join("\n");
}

// A short, dim summary shown after the call line. Computed from the RAW tool
// result (before any auto-check output is appended). Returns "" to add nothing
// (todos render their own list).
export function summarizeResult(name: string, a: Record<string, any>, result: string): string {
  const errored = result.startsWith("Error");
  const sep = (s: string) => color.dim("  ·  ") + s;
  switch (name) {
    case "read_file": {
      if (result.startsWith("(")) return sep(color.dim(result.split("\n")[0].replace(/[()]/g, "")));
      const lines = result.split("\n").filter((l) => /^\s*\d+\s/.test(l)).length;
      return sep(color.dim(`${lines} line${lines === 1 ? "" : "s"}`));
    }
    case "list_dir":
      return sep(color.dim(result.startsWith("(") ? "empty" : `${result.split("\n").length} entries`));
    case "search": {
      if (result.startsWith("No matches")) return sep(color.dim("no matches"));
      const rows = result.split("\n").filter((l) => /:\d+:/.test(l));
      const files = new Set(rows.map((l) => l.slice(0, l.indexOf(":"))));
      return sep(color.dim(`${rows.length} match${rows.length === 1 ? "" : "es"} in ${files.size} file${files.size === 1 ? "" : "s"}`));
    }
    case "edit_file": {
      if (errored) return sep(color.red("no match"));
      const { added, removed } = diffCounts(String(a.old_text ?? ""), String(a.new_text ?? ""));
      return sep(color.green(`+${added}`) + " " + color.red(`−${removed}`));
    }
    case "write_file": {
      if (errored) return sep(color.red("failed"));
      const lines = String(a.content ?? "").split("\n").length;
      return sep(color.green(`+${lines}`) + color.dim(" lines"));
    }
    case "run_bash":
      if (errored) return sep(color.red("✗ failed")); // failure leads with "Error" (the tool contract)
      return sep(result === "(no output)" ? color.green("✓") : color.green("✓") + color.dim(` ${result.split("\n").length} lines`));
    case "web_fetch":
      return sep(errored ? color.red("✗") : color.dim(`${result.length} chars`));
    case "web_search":
      return sep(result.startsWith("No results") ? color.dim("no results") : color.dim(`${(result.match(/^\d+\./gm) ?? []).length} results`));
    case "remember":
      return sep(color.green("✓ saved"));
    case "update_todos":
      return "";
    default:
      return sep(color.dim(`${result.length} chars`));
  }
}


// --- "thinking…" spinner ----------------------------------------------------
// Shown while waiting for the model's first token (or first tool call) so a slow
// or reasoning-heavy model never looks frozen. TTY-only — never pollutes piped
// or eval output. The returned stop() is idempotent.
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export function startSpinner(label: string): () => void {
  if (!process.stdout.isTTY || !useColor) return () => {};
  let i = 0;
  const draw = () => process.stdout.write("\r  " + color.brand(SPINNER[i = (i + 1) % SPINNER.length]) + " " + color.dim(label));
  process.stdout.write("\x1b[?25l"); // hide cursor
  draw();
  const timer = setInterval(draw, 80);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    process.stdout.write("\r\x1b[2K"); // clear the line; cursor stays HIDDEN until the next prompt
  };
}

// --- Logo mark --------------------------------------------------------------
// Rasterize the beecork mark from the logo's circle geometry (beecokrtrue.svg):
// a center disk (1025,894,r308) plus left/right circles (r256) with a circular
// hole cut by a mask (1025,894,r342). FULL blocks only (█/space) — half-blocks
// (▀▄) need the terminal's font + line spacing to tile perfectly, which many
// terminals (e.g. Apple Terminal) don't, leaving gaps that scramble the shape.
// One sample per cell renders cleanly everywhere; rows≈width/3.3 keeps the aspect
// (a character cell is ~2× taller than wide).
export function markLines(width: number): string[] {
  const inC = (x: number, y: number, cx: number, cy: number, r: number) =>
    (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  const green = (x: number, y: number) => {
    if (inC(x, y, 1025, 894, 308)) return true; // center disk (solid)
    const visible = !inC(x, y, 1025, 894, 342); // mask: outside the hole
    return visible && (inC(x, y, 768, 894, 256) || inC(x, y, 1282, 894, 256));
  };
  const xmin = 512, xmax = 1538, ymin = 586, ymax = 1202;
  const xs = (xmax - xmin) / width;
  const rows = Math.max(1, Math.round((ymax - ymin) / xs / 2)); // /2 → cells are ~2× tall
  const ys = (ymax - ymin) / rows;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < width; c++) {
      const x = xmin + (c + 0.5) * xs;
      const y = ymin + (r + 0.5) * ys;
      line += green(x, y) ? "█" : " ";
    }
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.filter((l) => l.length > 0);
}

// --- Startup banner ---------------------------------------------------------
export function printBanner(model: string, sources: string[]): void {
  const word = [
    "  _                              _    ",
    " | |__   ___  ___  ___ ___  _ __| | __",
    " | '_ \\ / _ \\/ _ \\/ __/ _ \\| '__| |/ /",
    " | |_) |  __/  __/ (_| (_) | |  |   < ",
    " |_.__/ \\___|\\___|\\___\\___/|_|  |_|\\_\\",
  ];
  const mark = markLines(24);
  const markW = Math.max(0, ...mark.map((l) => l.length));
  const wordW = Math.max(...word.map((l) => l.length));
  const cols = process.stdout.columns || 80;
  console.log();
  if (cols >= markW + 3 + wordW + 2) {
    // full lockup: mark on the LEFT, wordmark vertically centered at right
    const h = Math.max(mark.length, word.length);
    const mPad = Math.floor((h - mark.length) / 2);
    const wPad = Math.floor((h - word.length) / 2);
    for (let i = 0; i < h; i++) {
      const m = (mark[i - mPad] ?? "").padEnd(markW);
      const w = word[i - wPad] ?? "";
      console.log("  " + color.brand(`${m}   ${w}`));
    }
  } else if (cols >= wordW + 2) {
    for (const w of word) console.log("  " + color.brand(w)); // no room for the mark beside it
  } else {
    console.log("  " + color.brand("🐝 beecork")); // very narrow → just the name
  }
  console.log();

  // Info box below.
  const cork = sources.filter((s) => s.endsWith("cork.md")); // conventions (you write)
  const mem = sources.filter((s) => s.endsWith("memory.md")); // memory (beecork writes)
  const cwd = tildify(process.cwd());
  const rows: [string, string][] = [
    ["", "🐝  a tiny CLI coding agent"],
    ["dir", cwd],
    ["model", model],
    ["cork.md", cork.length ? cork.join(", ") : "none"],
    ["memory", mem.length ? mem.join(", ") : ".beecork/memory.md (empty)"],
    ["cmds", "/help · Shift+Tab (mode) · exit"],
  ];
  const lw = Math.max(...rows.map(([l]) => l.length)); // label column width
  const plain = (l: string, v: string) => (l ? l.padEnd(lw) + "   " + v : v);
  const bw = Math.max(...rows.map(([l, v]) => plain(l, v).length));
  const row = ([l, v]: [string, string]) => (l ? color.bold(l.padEnd(lw)) + color.dim("   " + v) : color.dim(v));
  if (cols < bw + 6) {
    for (const r of rows) console.log("  " + row(r)); // too narrow for the box — plain rows
  } else {
    console.log("  " + color.dim("╭─" + "─".repeat(bw) + "─╮"));
    for (const r of rows) {
      const pad = " ".repeat(Math.max(0, bw - plain(r[0], r[1]).length));
      console.log("  " + color.dim("│ ") + row(r) + pad + color.dim(" │"));
    }
    console.log("  " + color.dim("╰─" + "─".repeat(bw) + "─╯"));
  }
  console.log();
}
