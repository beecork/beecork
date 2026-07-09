// Low-level ANSI / VT escape sequences, named. ONE place so the intent of every terminal control is
// obvious and a typo in a bare "\x1b[…" literal can't silently break cursor math. Pure string
// builders — no I/O, no state. The TUI layer (chrome.ts, input.ts, ui.ts) composes these.
//
// Note on save/restore: we use the ESC 7 / ESC 8 (DECSC/DECRC) form rather than CSI s / CSI u. DECSC
// saves cursor POSITION *and* SGR attributes and is honored inside a DECSTBM scroll region, which is
// exactly what the pinned chrome needs.

const ESC = "\x1b";
const CSI = "\x1b[";

export const ansi = {
  // --- cursor visibility ---
  hideCursor: CSI + "?25l",
  showCursor: CSI + "?25h",

  // --- save / restore cursor (position + attributes) ---
  saveCursor: ESC + "7",
  restoreCursor: ESC + "8",

  // --- clearing ---
  clearLine: CSI + "2K",        // entire current line (cursor row unchanged)
  clearToEnd: CSI + "J",        // cursor → end of screen
  clearScreen: CSI + "2J",      // whole viewport
  clearScrollback: CSI + "3J",  // scrollback buffer (xterm extension)
  clearAndHome: CSI + "2J" + CSI + "3J" + CSI + "H", // clear viewport + scrollback, cursor to top-left
  cr: "\r",                     // carriage return (column 1, same row)
  home: CSI + "H",              // row 1, col 1

  // --- motion (n omitted → terminal default of 1) ---
  up: (n = 1) => CSI + n + "A",
  forward: (n = 1) => CSI + n + "C",
  moveTo: (row: number, col = 1) => CSI + row + ";" + col + "H",

  // --- scroll region (DECSTBM); 1-based, inclusive. reset → full screen ---
  setRegion: (top: number, bottom: number) => CSI + top + ";" + bottom + "r",
  resetRegion: CSI + "r",

  // --- bracketed paste mode ---
  bracketedPasteOn: CSI + "?2004h",
  bracketedPasteOff: CSI + "?2004l",

  // --- reverse video (used to draw the pinned input's block cursor) ---
  reverse: CSI + "7m",
  reverseOff: CSI + "27m",
};
