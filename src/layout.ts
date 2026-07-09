// Pure terminal text-layout math, extracted from the line editors so the fiddliest part of the TUI
// (soft-wrap accounting, cursor placement, multi-line navigation, horizontal windowing) is testable
// in isolation. No I/O, no escape sequences — just string → numbers. Covered by layout.test.ts.

import { displayWidth } from "./ui";

// Newlines-before (row) + chars-after-the-last-newline (col) for a text prefix. The one place this
// is computed. `col` is in CODE UNITS (matches buffer indexing), not display columns.
export function rowColOf(s: string): { row: number; col: number } {
  return { row: (s.match(/\n/g) || []).length, col: s.length - (s.lastIndexOf("\n") + 1) };
}

// Lay out an input buffer that the terminal soft-wraps at `cols`, with the first line offset by
// `promptW` display columns (continuation lines are assumed aligned under it — the editor indents
// them). Returns the total PHYSICAL rows the block occupies and the cursor's physical (row, col),
// both measuring width in DISPLAY columns (wide CJK/emoji = 2). `before` is the text left of the
// cursor (== `text` when masking, so the cursor sits at the end).
export function inputLayout(
  text: string,
  before: string,
  promptW: number,
  cols: number,
): { totalPhys: number; curPhysRow: number; curPhysCol: number } {
  const c = Math.max(1, cols);
  const physRows = text.split("\n").map((l) => Math.max(1, Math.ceil((promptW + displayWidth(l)) / c)));
  const totalPhys = physRows.reduce((a, b) => a + b, 0);
  const curLogicalRow = (before.match(/\n/g) || []).length;
  const curCol = promptW + displayWidth(before.slice(before.lastIndexOf("\n") + 1));
  const physBefore = physRows.slice(0, curLogicalRow).reduce((a, b) => a + b, 0);
  const curPhysRow = physBefore + Math.floor(curCol / c);
  const curPhysCol = curCol % c;
  return { totalPhys, curPhysRow, curPhysCol };
}

// Target buffer index when moving the cursor up/down one LOGICAL line, keeping the column where the
// destination line is long enough. Returns null when there's no line in that direction (caller stays
// put). Used by the multi-line prompt editor.
export function moveVertIndex(buf: string, cur: number, dir: -1 | 1): number | null {
  const lines = buf.split("\n");
  const { row, col } = rowColOf(buf.slice(0, cur));
  const target = row + dir;
  if (target < 0 || target >= lines.length) return null;
  let idx = 0;
  for (let i = 0; i < target; i++) idx += lines[i].length + 1; // +1 for each consumed "\n"
  return idx + Math.min(col, lines[target].length);
}

// First visible code-unit index for a single-line input box `avail` display-columns wide, given the
// cursor at `cur`: scroll the window right just enough to keep the cursor in view. Used by the pinned
// chrome's one-row input (long lines scroll horizontally instead of wrapping).
export function windowStart(text: string, cur: number, avail: number): number {
  let start = 0;
  if (displayWidth(text.slice(0, cur)) >= avail)
    while (start < cur && displayWidth(text.slice(start, cur)) >= avail) start++;
  return start;
}
