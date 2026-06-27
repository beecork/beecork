// Terminal presentation: colors, the startup banner, and small renderers.

import { homedir } from "node:os";
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

// --- Curated starter models (shown by `/models` with no argument) -----------
export const RECOMMENDED_MODELS: { slug: string; price: string; note: string }[] = [
  { slug: "deepseek/deepseek-v4-flash", price: "$0.09", note: "cheap + fast daily driver (default)" },
  { slug: "openai/gpt-5.4-nano", price: "$0.20", note: "cheap OpenAI" },
  { slug: "google/gemini-3.1-flash-lite", price: "$0.25", note: "cheap Google" },
  { slug: "z-ai/glm-4.7", price: "$0.40", note: "strong coder, great value" },
  { slug: "deepseek/deepseek-v4-pro", price: "$0.43", note: "stronger DeepSeek" },
  { slug: "z-ai/glm-5.2", price: "$0.95", note: "top agentic coder" },
  { slug: "anthropic/claude-haiku-4.5", price: "$1.00", note: "fast Claude" },
  { slug: "x-ai/grok-4.3", price: "$1.25", note: "xAI Grok" },
  { slug: "google/gemini-3.5-flash", price: "$1.50", note: "capable Google" },
  { slug: "anthropic/claude-sonnet-4.6", price: "$3.00", note: "top quality (premium)" },
  { slug: "openai/gpt-5.5", price: "$5.00", note: "OpenAI flagship (premium)" },
];

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
  switch (name) {
    case "read_file":
      return verb("read", color.cyan) + String(a.path ?? "") +
        (a.offset ? color.dim(`  :${a.offset}${a.limit ? `+${a.limit}` : ""}`) : "");
    case "list_dir":
      return verb("list", color.cyan) + String(a.path ?? ".");
    case "search":
      return verb("search", color.cyan) + color.dim(`"${a.pattern ?? ""}"`) +
        (a.path ? color.dim(`  in ${a.path}`) : "");
    case "write_file":
      return verb("write", color.yellow) + String(a.path ?? "");
    case "edit_file":
      return verb("edit", color.yellow) + String(a.path ?? "");
    case "run_bash":
      return color.yellow("$ ") + String(a.command ?? "");
    case "web_fetch":
      return verb("fetch", color.cyan) + String(a.url ?? "");
    case "web_search":
      return verb("web", color.cyan) + color.dim(`"${a.query ?? ""}"`);
    case "remember":
      return verb("note", color.cyan) + color.dim(String(a.fact ?? ""));
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
      if (errored) return sep(color.red("✗ failed"));
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
    process.stdout.write("\r\x1b[2K\x1b[?25h"); // clear the line + show cursor
  };
}

// --- Logo mark --------------------------------------------------------------
// Rasterize the beecork mark from the logo's circle geometry (beecokrtrue.svg):
// a center disk (1025,894,r308) plus left/right circles (r256) with a circular
// hole cut by a mask (1025,894,r342). Half-blocks give 2x vertical resolution.
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
  const rows = Math.max(1, Math.round((ymax - ymin) / xs / 2));
  const ys = (ymax - ymin) / (2 * rows); // fit shape exactly → vertically symmetric
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < width; c++) {
      const x = xmin + (c + 0.5) * xs;
      const t = green(x, ymin + (2 * r + 0.5) * ys);
      const b = green(x, ymin + (2 * r + 1.5) * ys);
      line += t && b ? "█" : t ? "▀" : b ? "▄" : " ";
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

  // Horizontal lockup: mark on the LEFT, wordmark vertically centered at right.
  const h = Math.max(mark.length, word.length);
  const mPad = Math.floor((h - mark.length) / 2);
  const wPad = Math.floor((h - word.length) / 2);
  console.log();
  for (let i = 0; i < h; i++) {
    const m = (mark[i - mPad] ?? "").padEnd(markW);
    const w = word[i - wPad] ?? "";
    console.log("  " + color.brand(`${m}   ${w}`));
  }
  console.log();

  // Info box below.
  const cork = sources.filter((s) => s.endsWith("cork.md")); // conventions (you write)
  const mem = sources.filter((s) => s.endsWith("memory.md")); // memory (beecork writes)
  const cwd = process.cwd().replace(homedir(), "~");
  const rows: [string, string][] = [
    ["", "🐝  a tiny CLI coding agent"],
    ["dir", cwd],
    ["model", model],
    ["cork.md", cork.length ? cork.join(", ") : "none"],
    ["memory", mem.length ? mem.join(", ") : ".beecork/memory.md (empty)"],
    ["cmds", "/help · /resume · exit"],
  ];
  const lw = Math.max(...rows.map(([l]) => l.length)); // label column width
  const plain = (l: string, v: string) => (l ? l.padEnd(lw) + "   " + v : v);
  const bw = Math.max(...rows.map(([l, v]) => plain(l, v).length));
  console.log("  " + color.dim("╭─" + "─".repeat(bw) + "─╮"));
  for (const [l, v] of rows) {
    const colored = l ? color.bold(l.padEnd(lw)) + color.dim("   " + v) : color.dim(v); // labels bold, values dim
    const pad = " ".repeat(Math.max(0, bw - plain(l, v).length));
    console.log("  " + color.dim("│ ") + colored + pad + color.dim(" │"));
  }
  console.log("  " + color.dim("╰─" + "─".repeat(bw) + "─╯"));
  console.log();
}
