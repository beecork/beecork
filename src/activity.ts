// The live activity indicator: the one thing on screen that MOVES while beecork is busy.
//
// WHY it exists: a turn spends most of its wall-clock inside two silent awaits — waiting for the
// model's first token, and waiting for a tool (a test run, a fetch, a sub-agent) to come back. With
// nothing moving, a slow-but-healthy run is indistinguishable from a hung one. So every long wait now
// gets the same line, and that line moves on THREE independent clocks, so at least one of them has
// visibly changed no matter how briefly you glance at it:
//
//   1. the spinner rotates every ~90ms   → "the process is alive right now"
//   2. the elapsed counter ticks each second → "and it has been alive this long"
//   3. a bee fact rotates every few seconds  → "…and this is a LONG wait, here, have something to read"
//
// The fact only appears once the wait is long enough to be worth explaining (BEFORE that the line
// stays terse, so a fast call doesn't flash a paragraph).
//
// Gated on being attached to a terminal, and on nothing else — piped/eval output is byte-identical to
// having no indicator at all. NO_COLOR is NOT part of the gate: it asks us not to PAINT, which
// color() already honours, and is not a request to hold still.
//
// LINE OWNERSHIP: an indicator owns exactly one terminal line and redraws it in place with CR +
// clear-line. `prefix` is text the caller already wrote there (a tool's action line) that must
// survive: it is redrawn on every frame and restored, cursor and all, when the indicator stops — so
// the caller can append its result summary to the same line exactly as if nothing had animated.

import { color, displayWidth, stripAnsi } from "./ui";
import { ansi } from "./ansi";

// One clockwise rotation of the braille "snake" — width-1 in every terminal (unlike hexagons or
// emoji, which are width-ambiguous and would break the cursor math on the line we redraw in place).
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_MS = 90;          // one full rotation per ~0.9s
const FACT_AFTER_MS = 4_000;  // stay terse below this — a quick call shouldn't flash a bee fact
const FACT_EVERY_MS = 9_000;  // then a new fact this often
const LONG_WAIT_MS = 30_000;  // past this the elapsed counter goes yellow: still fine, just slow
const MIN_FACT_W = 24;        // narrower than this and a clipped fact is noise, not information

// True things about bees, kept short enough to sit on one line next to a file path.
export const BEE_FACTS = [
  "a honeybee's wings beat about 230 times a second",
  "a forager visits 50-100 flowers on a single trip out",
  "one worker makes about 1/12 of a teaspoon of honey — in her whole life",
  "bees see ultraviolet: flowers wear landing marks we can't see",
  "the waggle dance codes direction as an angle to the sun, distance as duration",
  "a hive holds its brood nest near 35C all year, in any weather",
  "workers fan their wings to dry nectar down to about 18% water",
  "drones have no stinger at all",
  "a queen can lay 2,000 eggs a day at the height of the season",
  "bees have five eyes — two compound, three simple ones on top",
  "comb cells meet at 120 degrees, the shape that wastes the least wax",
  "one jar of honey costs the colony roughly two trips around the world",
  "bees can be trained to recognise human faces",
  "a summer forager lives about six weeks; a winter bee lives months",
  "the buzz is the wingbeat — bees have no voice",
  "bumblebees shiver to warm up, which is why they fly on cold days",
  "a scout dances harder for a better nest site — the argument is the dance",
  "swarms decide by quorum, not by majority",
  "propolis is tree resin: the hive's antiseptic caulk",
  "honey doesn't spoil because it is acidic and steals water from microbes",
  "the queen's pheromone is how 50,000 bees know she's still alive",
  "a bee's honey stomach is separate from the one she digests with",
  "wax comes out of the workers themselves, as scales on the abdomen",
  "when the sun is hidden, bees steer by the polarisation of the sky",
  "flowers carry a small negative charge; a flying bee carries a positive one",
  "'beeline' is literal — a loaded forager flies straight home",
  "of 20,000-odd bee species, most are solitary and make no honey",
  "a colony can be 60,000 bees in July and 10,000 in January",
];

// While the user is typing a mid-turn steering note, the indicator yields the bottom line so it
// doesn't clobber the echo. Set by index.ts's steering key handler.
let steeringOnScreen = false;
export function setSteeringActive(on: boolean): void { steeringOnScreen = on; }

// --- pure helpers (unit-tested) ---------------------------------------------

// "7s" / "1m04s". Sub-second waits render as "" — a counter that reads 0s the whole time is worse
// than no counter, because "stuck at zero" is exactly what a hang looks like.
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 1) return "";
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

// Which fact is on screen after `elapsedMs`, or null while the wait is still short. Pure in (seed,
// elapsed) so the rotation is testable without running a timer.
export function factFor(seed: number, elapsedMs: number): string | null {
  if (elapsedMs < FACT_AFTER_MS) return null;
  const step = Math.floor((elapsedMs - FACT_AFTER_MS) / FACT_EVERY_MS);
  return BEE_FACTS[(seed + step) % BEE_FACTS.length];
}

// How many facts a wait of this length showed — the amount to advance the shared cursor by, so the
// NEXT long wait opens on a fact you haven't just read (two waits in a row opening on the same fact
// would read as frozen, which is the one impression this whole file exists to prevent).
export function factsShown(elapsedMs: number): number {
  if (elapsedMs < FACT_AFTER_MS) return 0;
  return Math.floor((elapsedMs - FACT_AFTER_MS) / FACT_EVERY_MS) + 1;
}

// Clip to `w` display columns, marking the cut with an ellipsis.
function clip(s: string, w: number): string {
  if (displayWidth(s) <= w) return s;
  let out = "";
  for (const ch of s) {
    if (displayWidth(out + ch) > w - 1) break;
    out += ch;
  }
  return out + "…";
}

// Compose one frame. Never exceeds `columns - 1` visible columns: a line that wraps would leave the
// next CR at the start of the WRAPPED row, so every later frame would smear down the screen. The fact
// is the only part allowed to be dropped or clipped — the spinner and the counter always fit.
export function activityLine(o: {
  prefix?: string;   // already-colored text the caller owns on this line
  label?: string;
  frame: string;
  elapsedMs: number;
  fact?: string | null;
  columns: number;
}): string {
  const prefix = o.prefix ?? "";
  const head = prefix ? prefix + "  " : "  ";
  const headW = displayWidth(stripAnsi(prefix)) + 2;

  const elapsed = formatElapsed(o.elapsedMs);
  const label = o.label ?? "";
  // Shed parts, least important first, until what's left fits: the fact goes, then the label, then
  // the counter. The spinner itself always stays — a rotating glyph is the irreducible signal.
  const budget = o.columns - 1 - headW;
  const seg = (s: string) => (s ? 1 + displayWidth(s) : 0); // leading space + text
  let withLabel = Boolean(label);
  let withElapsed = Boolean(elapsed);
  const coreW = () => 1 + (withLabel ? seg(label) : 0) + (withElapsed ? seg(elapsed) : 0);
  if (coreW() > budget) withLabel = false;
  if (coreW() > budget) withElapsed = false;

  const core =
    color.brand(o.frame) +
    (withLabel ? " " + color.dim(label) : "") +
    // Past half a minute the counter turns yellow: still healthy, just long — and a colour change is
    // one more thing that visibly moves for anyone who only glances at the line.
    (withElapsed ? " " + (o.elapsedMs >= LONG_WAIT_MS ? color.yellow(elapsed) : color.dim(elapsed)) : "");

  const room = budget - coreW() - 3; // 3 = the " · " separator
  const fact = o.fact && room >= MIN_FACT_W ? color.dim(" · " + clip(o.fact, room)) : "";
  return head + core + fact;
}

// --- the running indicator --------------------------------------------------

interface Indicator { label: string; prefix: string; prefixW: number; startedAt: number; seed: number }

// A STACK, not a single indicator: a tool that runs its own model calls (the `explore` sub-agent)
// nests one inside another, and a parallel batch starts several siblings. Only the top of the stack
// draws; popping it hands the line back to the one underneath, which redraws on its next frame.
const stack: Indicator[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let frameIdx = 0;
let lineDirty = false; // did we actually put a frame on the current line? (see the restore in stop())
let factCursor = Math.floor(Math.random() * BEE_FACTS.length); // where the next long wait starts reading

function draw(): void {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (steeringOnScreen) return; // the user is typing a steering note on this line — don't overwrite it
  const columns = process.stdout.columns || 80; // || not ??: a pty with no window size reports 0, not undefined
  // No room for even a spinner after the caller's text: leave the line exactly as the caller wrote
  // it. Redrawing a line that wraps is what corrupts the display, so we'd rather not animate.
  if (top.prefixW + 8 > columns) return;
  const elapsedMs = Date.now() - top.startedAt;
  lineDirty = true;
  process.stdout.write(
    ansi.cr + ansi.clearLine +
    activityLine({ prefix: top.prefix, label: top.label, frame: FRAMES[frameIdx], elapsedMs, fact: factFor(top.seed, elapsedMs), columns }),
  );
}

// Hand the current line back to a caller that needs to print on it (a steering echo, say), so its
// text doesn't land ON a frame and leave a stranded half-line above. Returns true if there WAS a
// frame to clear — i.e. the cursor now sits at column 1 of an empty row and the caller can write
// straight away instead of opening with a newline. The next frame redraws wherever the caller leaves
// the cursor, so the indicator simply continues below.
export function clearActivityLine(): boolean {
  if (!lineDirty) return false;
  lineDirty = false;
  process.stdout.write(ansi.cr + ansi.clearLine);
  return true;
}

// Start indicating that something is happening; the returned stop() is idempotent and restores the
// line to just `prefix`, cursor included, so the caller can carry on writing where it left off.
export function startActivity(label: string, opts?: { prefix?: string }): () => void {
  if (!process.stdout.isTTY) return () => {}; // piped/eval output stays byte-identical
  const prefix = opts?.prefix ?? "";
  const ind: Indicator = { label, prefix, prefixW: displayWidth(stripAnsi(prefix)), startedAt: Date.now(), seed: factCursor };
  stack.push(ind);
  if (!timer) {
    process.stdout.write(ansi.hideCursor);
    timer = setInterval(() => { frameIdx = (frameIdx + 1) % FRAMES.length; draw(); }, FRAME_MS);
    timer.unref?.(); // a leaked indicator must never be the handle that keeps the process from exiting
  }
  draw();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const i = stack.indexOf(ind);
    if (i >= 0) stack.splice(i, 1);
    factCursor = (factCursor + factsShown(Date.now() - ind.startedAt)) % BEE_FACTS.length;
    if (stack.length === 0) {
      clearInterval(timer!);
      timer = null;
      // Hand the line back exactly as the caller left it — but ONLY if we ever wrote on it. A prefix
      // too wide to animate was never redrawn and may have WRAPPED, and CR lands at the start of the
      // last visual row, so "restoring" it there would print it a second time. And while a steering
      // note is on screen the line belongs to the key handler; clearing it would eat what the user
      // typed. (Stops are LIFO — every call site pairs start/stop in a try/finally — so `ind` is the
      // indicator that owns this line.) The cursor stays HIDDEN until the next prompt draws it,
      // which is what the line editor already expects.
      if (lineDirty && !steeringOnScreen) process.stdout.write(ansi.cr + ansi.clearLine + ind.prefix);
      lineDirty = false;
    }
  };
}
