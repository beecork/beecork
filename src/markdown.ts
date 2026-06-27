// A tiny streaming markdown → ANSI renderer. The model streams text token by
// token; we buffer to line/block boundaries (a table or fenced code block needs
// its whole block) and render: headings, bold/italic/code/strikethrough, links,
// bullet + numbered lists, blockquotes, horizontal rules, fenced code, and
// pipe tables (column-aligned). Zero dependencies — just ANSI from ui.color.
//
// What the model RECEIVES back in history is always the raw markdown (callModel
// accumulates `content` separately); this only changes what the human SEES.

import { color, stripAnsi } from "./ui";

const NUL = "\x00"; // sentinel marking a protected inline-code span (never in model text)
const visLen = (s: string) => stripAnsi(s).length; // width ignoring ANSI color escapes
const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/; // a horizontal rule (--- / *** / ___)
const CODE_SPAN_RE = new RegExp(`${NUL}(\\d+)${NUL}`, "g"); // a protected inline-code placeholder

// Inline spans within one line. Code is protected first so we don't style inside it.
function inline(s: string): string {
  const code: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { code.push(c); return `${NUL}${code.length - 1}${NUL}`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => color.bold(t));
  s = s.replace(/__([^_]+)__/g, (_m, t) => color.bold(t));
  s = s.replace(/(^|[^\\*])\*([^*\s][^*]*?)\*/g, (_m, p, t) => p + color.italic(t));
  s = s.replace(/~~([^~]+)~~/g, (_m, t) => color.strike(t));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, txt, url) => color.cyan(txt) + color.dim(` (${url})`));
  s = s.replace(CODE_SPAN_RE, (_m, i) => color.cyan(code[+i]));
  return s;
}

// A single non-table, non-code line → its block style.
function blockLine(line: string): string {
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) return color.bold(color.cyan(inline(h[2])));
  if (HR_RE.test(line)) return color.dim("─".repeat(40)); // hr
  const q = line.match(/^\s*>\s?(.*)$/);
  if (q) return color.dim("│ " + inline(q[1]));
  const b = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (b) return b[1] + color.cyan("•") + " " + inline(b[2]);
  const n = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (n) return n[1] + color.cyan(n[2] + ".") + " " + inline(n[3]);
  return inline(line);
}

// A buffered pipe-table → column-aligned, bold header, the |---| row dropped.
function renderTable(rows: string[]): string {
  const parse = (r: string) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const grid = rows.map(parse);
  const isSep = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  const sepIdx = grid.findIndex(isSep);
  const body = grid.filter((_, i) => i !== sepIdx);
  if (body.length === 0) return "";
  const ncol = Math.max(...body.map((r) => r.length));
  // Style each cell FIRST, then measure VISIBLE width. inline() strips markdown
  // (`code`, **bold**) which changes width, so padding must use the rendered width,
  // not the raw markdown length — otherwise cells with backticks misalign.
  const styled = body.map((r, ri) =>
    Array.from({ length: ncol }, (_, c) => {
      const raw = r[c] ?? "";
      return sepIdx >= 0 && ri === 0 ? color.bold(inline(raw)) : inline(raw); // header row bold
    }),
  );
  const width = Array.from({ length: ncol }, (_, c) => Math.max(...styled.map((r) => visLen(r[c]))));
  const out = styled.map((r) => {
    const cells = r.map((cell, c) => cell + " ".repeat(Math.max(0, width[c] - visLen(cell))));
    return "  " + cells.join(color.dim("  │  "));
  });
  return out.join("\n") + "\n";
}

// Feed streamed text via push(); call end() when the turn's text is complete.
export function createMarkdownStream(write: (s: string) => void) {
  let buf = "";
  let scanFrom = 0; // how far into buf we've already searched for "\n" (avoids O(n²) on a long line)
  let inCode = false;
  let first = true;
  let table: string[] = [];
  const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const flushTable = () => { if (table.length) { write(renderTable(table)); table = []; } };

  function emit(line: string) {
    const fence = line.match(/^\s*```(\w*)\s*$/);
    // Don't let the first rendered block (table/fence/rule/heading) start inline right
    // after the "bee: " prefix — push it onto its own line.
    if (first && line.trim()) {
      first = false;
      const block = !!fence || isRow(line) || HR_RE.test(line) || /^#{1,6}\s/.test(line);
      if (block) write("\n");
    }
    if (fence) {
      flushTable();
      inCode = !inCode;
      write(color.dim("┄".repeat(40)) + "\n");
      return;
    }
    if (inCode) { flushTable(); write(color.dim("  " + line) + "\n"); return; }
    if (isRow(line)) { table.push(line); return; }
    flushTable();
    write(blockLine(line) + "\n");
  }

  return {
    push(text: string): void {
      buf += text;
      let i: number;
      while ((i = buf.indexOf("\n", scanFrom)) >= 0) {
        emit(buf.slice(0, i));
        buf = buf.slice(i + 1);
        scanFrom = 0;
      }
      scanFrom = buf.length; // the rest of buf has no newline — don't re-scan it next push
    },
    end(): void {
      if (buf) { emit(buf); buf = ""; }
      flushTable();
      if (inCode) { write(color.dim("┄".repeat(40)) + "\n"); inCode = false; } // close an unterminated code block
    },
  };
}
