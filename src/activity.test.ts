import { test } from "node:test";
import assert from "node:assert/strict";
import { BEE_FACTS, formatElapsed, factFor, factsShown, activityLine, startActivity } from "./activity";
import { displayWidth, stripAnsi } from "./ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// What a frame actually puts on screen: drop the colours AND the cursor/erase controls.
const visible = (s: string) => stripAnsi(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
// Chunks the indicator itself writes — everything else on stdout belongs to someone else.
const isOurs = (s: string) => s.startsWith("\r") || s === "\x1b[?25l"; // redraws, plus the one hide-cursor
const isRedraw = (s: string) => s.startsWith("\r");

// Run `fn` as if stdout were a 100-column terminal, collecting the frames the indicator draws.
//
// Two things here are load-bearing, and both were learned the hard way:
//   - the yield FIRST: node:test flushes a finished test's TAP block on a LATER tick, so without it
//     the previous test's result line lands in this capture;
//   - the re-emit in the finally: anything the RUNNER wrote while we held the pen is put back, or the
//     run silently reports fewer tests than it ran (it reported nine fewer).
async function withFakeTty<T>(fn: (frames: () => string[]) => Promise<T>): Promise<T> {
  await new Promise((r) => setTimeout(r, 0));
  const ttyDesc = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const colDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "columns", { value: 100, configurable: true });
  const real = process.stdout.write;
  const seen: string[] = [];
  process.stdout.write = ((chunk: unknown) => { seen.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    return await fn(() => seen.filter(isRedraw));
  } finally {
    process.stdout.write = real;
    for (const chunk of seen) if (!isOurs(chunk)) real.call(process.stdout, chunk);
    if (ttyDesc) Object.defineProperty(process.stdout, "isTTY", ttyDesc);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    if (colDesc) Object.defineProperty(process.stdout, "columns", colDesc);
    else delete (process.stdout as { columns?: number }).columns;
  }
}

const FACT_AFTER_MS = 4_000; // mirrors activity.ts — the wait length at which a fact appears
const FACT_EVERY_MS = 9_000;

test("formatElapsed: sub-second reads as nothing, not as a stuck 0s", () => {
  assert.equal(formatElapsed(0), "");
  assert.equal(formatElapsed(999), "");
  assert.equal(formatElapsed(1000), "1s");
  assert.equal(formatElapsed(59_999), "59s");
});

test("formatElapsed: minutes stay two-digit so the line doesn't jitter", () => {
  assert.equal(formatElapsed(60_000), "1m00s");
  assert.equal(formatElapsed(64_000), "1m04s");
  assert.equal(formatElapsed(671_000), "11m11s");
});

test("factFor: stays quiet until the wait is worth explaining, then rotates", () => {
  assert.equal(factFor(0, 0), null);
  assert.equal(factFor(0, FACT_AFTER_MS - 1), null);
  assert.equal(factFor(0, FACT_AFTER_MS), BEE_FACTS[0]);
  assert.equal(factFor(0, FACT_AFTER_MS + FACT_EVERY_MS - 1), BEE_FACTS[0]);
  assert.equal(factFor(0, FACT_AFTER_MS + FACT_EVERY_MS), BEE_FACTS[1]);
  // the seed is where this wait starts reading, and the rotation wraps
  assert.equal(factFor(3, FACT_AFTER_MS), BEE_FACTS[3]);
  assert.equal(factFor(BEE_FACTS.length - 1, FACT_AFTER_MS + FACT_EVERY_MS), BEE_FACTS[0]);
});

test("factsShown: how far the shared cursor advances, so two waits never open on the same fact", () => {
  assert.equal(factsShown(0), 0);
  assert.equal(factsShown(FACT_AFTER_MS - 1), 0);
  assert.equal(factsShown(FACT_AFTER_MS), 1);
  assert.equal(factsShown(FACT_AFTER_MS + FACT_EVERY_MS), 2);
  // a long wait advances past everything it showed
  assert.equal(factsShown(FACT_AFTER_MS + FACT_EVERY_MS * 5), 6);
});

test("BEE_FACTS: usable one-liners, no repeats", () => {
  assert.ok(BEE_FACTS.length >= 12); // enough that a long wait doesn't visibly loop
  assert.equal(new Set(BEE_FACTS).size, BEE_FACTS.length);
  for (const f of BEE_FACTS) {
    assert.ok(f.length > 0 && f.length <= 80, `too long to sit beside a path: ${f}`);
    assert.doesNotMatch(f, /[\r\n\x1b]/); // a control byte here would corrupt the redrawn line
  }
});

// The load-bearing property: the line is redrawn in place with CR, so if it ever WRAPS every later
// frame smears down the screen. It must fit, at every width, with every part it can carry.
test("activityLine: never exceeds the terminal width", () => {
  for (const columns of [8, 20, 40, 80, 120, 200]) {
    for (const prefix of ["", "  read   src/api.ts", "  $ npm run typecheck -- --project tsconfig.json"]) {
      for (const elapsedMs of [0, 5_000, 45_000, 3_600_000]) {
        const line = activityLine({ prefix, label: "thinking…", frame: "⠹", elapsedMs, fact: BEE_FACTS[0], columns });
        const w = displayWidth(stripAnsi(line));
        // A prefix longer than the terminal is the caller's own line and is passed through untouched;
        // the indicator only promises not to ADD past the edge. (draw() skips those outright.)
        const floor = displayWidth(prefix) + 2 + 1; // prefix + gap + the spinner that always stays
        assert.ok(w <= Math.max(columns - 1, floor), `${columns} cols → width ${w}: ${JSON.stringify(stripAnsi(line))}`);
      }
    }
  }
});

test("activityLine: sheds the fact, then the label, then the counter as room runs out", () => {
  const of = (columns: number) => stripAnsi(activityLine({ label: "thinking…", frame: "⠹", elapsedMs: 12_000, fact: BEE_FACTS[0], columns }));
  assert.match(of(120), /⠹ thinking… 12s · /); // everything
  assert.equal(of(30), "  ⠹ thinking… 12s");    // fact dropped — a clipped stub is noise
  assert.equal(of(16), "  ⠹ 12s");              // label dropped, the counter is worth more
  assert.equal(of(6), "  ⠹");                   // the rotation is the irreducible signal
});

test("activityLine: keeps the caller's line intact and appends to it", () => {
  const prefix = "  $ npm test";
  const line = stripAnsi(activityLine({ prefix, frame: "⠹", elapsedMs: 8_000, fact: BEE_FACTS[0], columns: 120 }));
  assert.ok(line.startsWith(prefix + "  ⠹ 8s · "), line);
});

test("activityLine: a clipped fact is marked as clipped", () => {
  const long = "x".repeat(200);
  const line = stripAnsi(activityLine({ label: "", frame: "⠹", elapsedMs: 8_000, fact: long, columns: 60 }));
  assert.ok(line.endsWith("…"), line);
  assert.ok(displayWidth(line) <= 59);
});

// --- the running indicator (real timer, fake terminal) ----------------------

test("startActivity: animates in place and hands the caller's line back untouched", async () => {
  const prefix = "  $ npm test";
  await withFakeTty(async (frames) => {
    const stop = startActivity("", { prefix });
    await sleep(320);
    stop();
    const f = frames();
    assert.ok(f.length >= 3, `expected several frames, got ${f.length}`);
    // It MOVED: at least two different glyphs went past. (A "spinner" that redraws one frame forever
    // is exactly the frozen-looking state this module exists to rule out.)
    assert.ok(new Set(f.map(visible)).size >= 2, "the frames never changed");
    // Every frame rewrites the whole line from column 1 — CR then erase, or the old text shows through.
    for (const x of f) assert.ok(x.startsWith("\r\x1b[2K"), JSON.stringify(x));
    // The caller's text survives every redraw, and the last write leaves the line as just that text,
    // so the result summary appended afterwards completes the SAME line.
    for (const x of f.slice(0, -1)) assert.ok(visible(x).startsWith(prefix + "  "), JSON.stringify(visible(x)));
    assert.equal(visible(f[f.length - 1]), prefix);
  });
});

test("startActivity: a nested indicator borrows the line and gives it back", async () => {
  await withFakeTty(async (frames) => {
    const outer = startActivity("exploring…");
    await sleep(150);
    const inner = startActivity("thinking…");
    await sleep(150);
    inner();
    await sleep(150);
    outer();
    const f = frames().map(visible);
    const firstInner = f.findIndex((x) => x.includes("thinking…"));
    assert.ok(f[0].includes("exploring…"), "the outer indicator should draw first");
    assert.ok(firstInner > 0, "the inner indicator should take over the line");
    // …and once it stops, the outer one is back — the line is NOT left blank mid-explore.
    assert.ok(f.lastIndexOf(f.filter((x) => x.includes("exploring…")).pop()!) > firstInner);
    assert.equal(f[f.length - 1], ""); // cleared only when the LAST indicator stops
  });
});

test("startActivity: stop() is idempotent", async () => {
  await withFakeTty(async (frames) => {
    const stop = startActivity("thinking…");
    await sleep(120);
    stop();
    const drawn = frames().length;
    assert.ok(drawn > 0);
    stop();
    stop();
    assert.equal(frames().length, drawn, "a second stop() must not touch the terminal");
  });
});

test("startActivity: an action line too wide to animate is left completely alone", async () => {
  // CR lands at the start of the LAST visual row of a wrapped line, so a "restore" there would print
  // the caller's text a second time. Nothing is drawn, so nothing is restored.
  await withFakeTty(async (frames) => {
    const stop = startActivity("", { prefix: "  $ " + "x".repeat(140) });
    await sleep(200);
    stop();
    assert.deepEqual(frames(), []);
  });
});

test("startActivity: off a terminal it writes nothing at all", async () => {
  const real = process.stdout.write;
  const seen: string[] = [];
  process.stdout.write = ((chunk: unknown) => { seen.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    startActivity("thinking…", { prefix: "  $ npm test" })();
  } finally {
    process.stdout.write = real;
  }
  assert.deepEqual(seen, []); // piped/eval output must stay byte-identical to having no indicator
});
