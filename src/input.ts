// Raw-mode terminal input — a small line editor with a live slash-command menu,
// command highlighting, history, and a reusable arrow-key selector. Zero deps;
// just Node's keypress events + ANSI. Used only on a TTY; the non-TTY path in
// index.ts falls back to readline.
//
// One keypress listener is attached for the whole session (initInput). Widgets
// (readPrompt / readChoice / selectMenu) push themselves as the active handler
// and pop on finish, so they nest cleanly: an approval prompt can run "on top of"
// a turn, which itself runs "on top of" nothing.

import { emitKeypressEvents } from "node:readline";
import { color, stripAnsi, isPrintableCodePoint, displayWidth } from "./ui";

const out = (s: string) => process.stdout.write(s);

type KeyHandler = (str: string | undefined, key: Key | undefined) => void;
interface Key { sequence?: string; name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean }

let active: KeyHandler | null = null;
let started = false;

// Attach the single dispatcher + enter raw mode. Safe to call once; no-op off TTY.
export function initInput(): void {
  if (started || !process.stdin.isTTY) return;
  started = true;
  process.stdin.setRawMode(true);
  out("\x1b[?2004l"); // DISABLE bracketed paste — some terminals (Apple Terminal) draw visible [ … ]
                      // brackets around the input line when it's on. Multi-line paste is handled by
                      // the deferred-Enter heuristic in readPrompt instead.
  emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", (str: string | undefined, key: Key | undefined) => active?.(str, key));
}

export function teardownInput(): void {
  if (started && process.stdin.isTTY) {
    out("\x1b[?2004h\x1b[?25h"); // restore bracketed paste + show the cursor for the shell
    process.stdin.setRawMode(false);
    process.stdin.pause(); // release the keep-alive so the process can exit
  }
}

// Make `h` the active key handler; returns a function that restores the previous one.
export function pushKeyHandler(h: KeyHandler): () => void {
  const prev = active;
  active = h;
  return () => { active = prev; };
}

const isEnter = (k?: Key) => k?.name === "return" || k?.name === "enter";

// ---------------------------------------------------------------------------
// readPrompt — the main line editor.
// ---------------------------------------------------------------------------

export type PromptResult = { type: "line"; value: string } | { type: "quit" } | { type: "eof" };
export interface MenuItem { name: string; desc: string }
export interface PromptOpts {
  promptString: () => string;          // colored prompt (may change, e.g. mode tag)
  commands?: MenuItem[];               // built-in slash commands (name incl. leading /)
  skills?: string[];                   // skill names (without /)
  history?: string[];                  // shared history, mutated on submit
  mask?: boolean;                      // secret entry — no echo, no menu, no history
  onShiftTab?: () => void;             // rotate mode; we re-render afterwards
}

const MENU_MAX = 8;

export function readPrompt(opts: PromptOpts): Promise<PromptResult> {
  if (!process.stdin.isTTY) return Promise.resolve({ type: "eof" });
  const history = opts.history ?? [];
  const all: MenuItem[] = [
    ...(opts.commands ?? []),
    ...(opts.skills ?? []).map((n) => ({ name: "/" + n, desc: "skill" })),
  ];

  return new Promise((resolve) => {
    let buf = "";
    let cur = 0;            // cursor index within buf
    let hist = history.length; // == length means "the new line being typed"
    let sel = 0;            // selected menu row
    let menuHidden = false; // Esc hides the menu until the buffer changes
    // Paste detection without bracketed-paste mode: a paste delivers its keystrokes in a rapid
    // burst (often several stdin chunks back-to-back), whereas a human's Enter always lands well
    // after the previous key. We count keys per burst and reset after a short IDLE gap — so the
    // count spans multiple chunks of one paste, but a human keypress (>>8ms apart) starts fresh.
    const BURST_IDLE_MS = 8;
    let burstLen = 0;
    let burstTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingRender = false; // a render coalesced to the end of the current burst (see insert())

    const matches = (): MenuItem[] => {
      if (opts.mask) return [];
      const m = buf.match(/^\/(\S*)$/); // only while typing the command word (no space yet)
      if (!m) return [];
      const pre = "/" + m[1];
      return all.filter((c) => c.name.startsWith(pre)).slice(0, MENU_MAX);
    };
    const menu = () => (menuHidden ? [] : matches());

    // The buffer keeps real "\n" (from a multi-line paste); render() draws them as real rows.
    const highlight = (): string => {
      if (opts.mask) return "*".repeat(buf.length);
      const m = buf.match(/^(\/\S*)([\s\S]*)$/);
      if (!m) return buf;
      const [, token, rest] = m;
      const known = all.some((c) => c.name === token);
      const partial = all.some((c) => c.name.startsWith(token));
      const styled = known ? color.green(token) : partial ? color.cyan(token) : color.red(token);
      return styled + rest;
    };

    let lastCurRow = 0; // cursor's row offset within the block after the previous render (for clearing)

    // Row (newlines before) + column-within-line for a text prefix. The one place this is computed.
    const rowColOf = (s: string) => ({ row: (s.match(/\n/g) || []).length, col: s.length - (s.lastIndexOf("\n") + 1) });

    function drawBlock(): { promptW: number } {
      const prompt = opts.promptString();
      const promptW = stripAnsi(prompt).length;
      const indent = " ".repeat(promptW); // continuation lines align under the first line's text
      const lines = highlight().split("\n");
      out(prompt + lines[0]);
      for (let i = 1; i < lines.length; i++) out("\n" + indent + lines[i]);
      return { promptW };
    }

    function render() {
      const mm = menu();
      if (sel >= mm.length) sel = Math.max(0, mm.length - 1);
      // Return to the top-left of the previously drawn block, then clear it + everything below.
      out("\x1b[?25l");
      if (lastCurRow > 0) out(`\x1b[${lastCurRow}A`);
      out("\r\x1b[J");

      const { promptW } = drawBlock();

      const cols = Math.max(1, process.stdout.columns || 80);
      for (let i = 0; i < mm.length; i++) {
        const m = mm[i];
        const name = m.name.padEnd(10);
        const maxDesc = Math.max(0, cols - name.length - 4); // clamp desc so a wide menu row can't wrap
        const desc = m.desc.length > maxDesc ? m.desc.slice(0, Math.max(0, maxDesc - 1)) + "…" : m.desc;
        out("\n" + (i === sel ? color.green("› " + name) + " " + color.dim(desc) : color.dim("  " + name + " " + desc)));
      }

      // Account for terminal soft-wrap: a logical line wider than `cols` spans multiple PHYSICAL
      // rows. Width is in DISPLAY columns (wide CJK/emoji = 2), including the prompt/indent (promptW).
      const text = opts.mask ? "*".repeat(buf.length) : buf;
      const physRows = text.split("\n").map((l) => Math.max(1, Math.ceil((promptW + displayWidth(l)) / cols)));
      const totalInputPhys = physRows.reduce((a, b) => a + b, 0);

      // Cursor → physical (row, col), measuring the current line's prefix in display columns.
      const before = opts.mask ? text : buf.slice(0, cur);
      const curLogicalRow = (before.match(/\n/g) || []).length;
      const curCol = promptW + displayWidth(before.slice(before.lastIndexOf("\n") + 1));
      const physBefore = physRows.slice(0, curLogicalRow).reduce((a, b) => a + b, 0);
      const curPhysRow = physBefore + Math.floor(curCol / cols);
      const curPhysCol = curCol % cols;

      const lastDrawnRow = totalInputPhys - 1 + mm.length;
      if (lastDrawnRow > curPhysRow) out(`\x1b[${lastDrawnRow - curPhysRow}A`);
      out("\r" + (curPhysCol > 0 ? `\x1b[${curPhysCol}C` : "") + "\x1b[?25h");
      lastCurRow = curPhysRow;
    }

    function finish(result: PromptResult) {
      restore();
      if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
      pendingRender = false; // don't let a queued burst-flush redraw after we've committed the line
      out("\x1b[?25l");
      if (lastCurRow > 0) out(`\x1b[${lastCurRow}A`);
      out("\r\x1b[J");
      drawBlock(); // leave the final (multi-line) input in scrollback; cursor stays HIDDEN
      out("\n");
      if (result.type === "line" && result.value.trim() && !opts.mask) history.push(result.value);
      resolve(result);
    }

    function insert(s: string) {
      buf = buf.slice(0, cur) + s + buf.slice(cur);
      cur += s.length;
      menuHidden = false;
      sel = 0;
      // Coalesce: during a paste burst this is called per character — render once when it drains
      // (the microtask above), instead of an O(N) redraw per inserted char.
      pendingRender = true;
    }

    function onKey(str: string | undefined, key: Key | undefined) {
      const mm = menu();
      // Track the current burst; reset it (and flush one coalesced render) after BURST_IDLE_MS of
      // no input. Re-arming the timer on each key makes the burst span multiple paste chunks.
      burstLen++;
      if (burstTimer) clearTimeout(burstTimer);
      burstTimer = setTimeout(() => { burstTimer = null; burstLen = 0; if (pendingRender) { pendingRender = false; render(); } }, BURST_IDLE_MS);
      if (isEnter(key)) {
        // A newline that's part of a burst (a paste — many keys this tick) is text, not submit.
        // Shift/Alt+Enter is always a deliberate newline. A lone Enter (its own event) submits.
        if (key?.shift || key?.meta || burstLen > 1) { insert("\n"); return; }
        return finish({ type: "line", value: buf });
      }
      if (key?.ctrl && key.name === "c") {
        if (buf) { buf = ""; cur = 0; render(); } // first Ctrl-C clears the line
        else finish({ type: "quit" });            // again on an empty line → quit
        return;
      }
      if (key?.ctrl && key.name === "d") { if (!buf) finish({ type: "eof" }); return; }
      if (key?.name === "tab" && key.shift) { opts.onShiftTab?.(); render(); return; }
      if (key?.name === "tab") { if (mm.length) { buf = mm[sel].name + " "; cur = buf.length; menuHidden = false; render(); } return; }
      if (key?.name === "up") { if (mm.length) { sel = (sel - 1 + mm.length) % mm.length; render(); } else if (buf.includes("\n")) moveVert(-1); else histPrev(); return; }
      if (key?.name === "down") { if (mm.length) { sel = (sel + 1) % mm.length; render(); } else if (buf.includes("\n")) moveVert(1); else histNext(); return; }
      if (key?.name === "left") { if (cur > 0) cur--; render(); return; }
      if (key?.name === "right") { if (cur < buf.length) cur++; render(); return; }
      if (key?.name === "home" || (key?.ctrl && key.name === "a")) { cur = 0; render(); return; }
      if (key?.name === "end" || (key?.ctrl && key.name === "e")) { cur = buf.length; render(); return; }
      if (key?.ctrl && key.name === "u") { buf = buf.slice(cur); cur = 0; menuHidden = false; render(); return; }
      if (key?.name === "backspace") { if (cur > 0) { buf = buf.slice(0, cur - 1) + buf.slice(cur); cur--; menuHidden = false; render(); } return; }
      if (key?.name === "delete") { if (cur < buf.length) { buf = buf.slice(0, cur) + buf.slice(cur + 1); menuHidden = false; render(); } return; }
      if (key?.name === "escape") { if (mm.length) { menuHidden = true; render(); } return; }
      // printable (incl. space + astral/emoji, which are 2 UTF-16 units = 1 code point);
      // ignore control/meta chords, ESC sequences, DEL, and C1 controls
      if (str && !key?.ctrl && !key?.meta && [...str].length === 1) {
        if (isPrintableCodePoint(str.codePointAt(0)!)) insert(str);
      }
    }

    // Move the cursor up/down one line in a multi-line buffer, keeping the column where possible.
    function moveVert(dir: -1 | 1) {
      const lines = buf.split("\n");
      const { row, col } = rowColOf(buf.slice(0, cur));
      const target = row + dir;
      if (target < 0 || target >= lines.length) return;
      let idx = 0;
      for (let i = 0; i < target; i++) idx += lines[i].length + 1; // +1 for each "\n"
      cur = idx + Math.min(col, lines[target].length);
      render();
    }

    function histPrev() {
      if (history.length === 0) return;
      hist = Math.max(0, hist - 1);
      buf = history[hist] ?? "";
      cur = buf.length;
      render();
    }
    function histNext() {
      if (hist >= history.length) return;
      hist += 1;
      buf = hist === history.length ? "" : history[hist];
      cur = buf.length;
      render();
    }

    const restore = pushKeyHandler(onKey);
    render();
  });
}

// ---------------------------------------------------------------------------
// readChoice — read one of the y/n/a approval keys. Esc / Ctrl-C deny (the safe
// default); ANY other key is IGNORED (keep waiting) so a stray keystroke can't
// accidentally deny + cancel the action.
// ---------------------------------------------------------------------------

export function readChoice(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return Promise.resolve("n");
  return new Promise((resolve) => {
    out(prompt);
    const restore = pushKeyHandler((str, key) => {
      let ch: string;
      if ((key?.ctrl && key.name === "c") || key?.name === "escape" || isEnter(key)) ch = "n"; // Esc/Ctrl-C/Enter = deny (safe default)
      else if (str && /^[yna]$/i.test(str)) ch = str.toLowerCase(); // the actual choices
      else return; // a stray letter / arrow / any other key → ignore and keep waiting
      restore();
      out(ch + "\n");
      resolve(ch);
    });
  });
}

// ---------------------------------------------------------------------------
// selectMenu — a reusable arrow-key picker (used by /model).
// ---------------------------------------------------------------------------

export interface SelectOpts<T> { title: string; items: { label: string; value: T; hint?: string }[]; initial?: number }

export function selectMenu<T>(opts: SelectOpts<T>): Promise<T | null> {
  if (!process.stdin.isTTY || opts.items.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let sel = Math.max(0, Math.min(opts.initial ?? 0, opts.items.length - 1));
    let drawn = 0;

    function render() {
      out("\x1b[?25l");
      if (drawn > 0) out(`\x1b[${drawn}A`);
      out("\r\x1b[J");
      out(color.dim(opts.title) + "\n");
      opts.items.forEach((it, i) => {
        const row = i === sel ? color.green("› " + it.label) : "  " + it.label;
        out(row + (it.hint ? color.dim("  " + it.hint) : "") + "\n");
      });
      drawn = opts.items.length + 1;
    }
    function finish(v: T | null) {
      restore();
      if (drawn > 0) out(`\x1b[${drawn}A\r\x1b[J`);
      out("\x1b[?25h");
      resolve(v);
    }
    const restore = pushKeyHandler((_str, key) => {
      if (key?.name === "up") { sel = (sel - 1 + opts.items.length) % opts.items.length; render(); }
      else if (key?.name === "down") { sel = (sel + 1) % opts.items.length; render(); }
      else if (isEnter(key)) finish(opts.items[sel].value);
      else if (key?.name === "escape" || key?.name === "q" || (key?.ctrl && key.name === "c")) finish(null);
    });
    render();
  });
}
