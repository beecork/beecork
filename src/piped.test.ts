// Off-TTY line input. This exists because the previous implementation FAILED SILENTLY: readline
// drained piped stdin during startup, the first question() rejected with "readline was closed", the
// loop caught it and broke — so `echo "..." | beecork` printed the banner and exited having done
// nothing. A test that pipes real input is the only thing that catches that. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipedLines } from "./input";

const feed = (text: string) => createInterface({ input: Readable.from([text]) });

test("lines that arrive BEFORE anyone asks are queued, not lost", async () => {
  const next = pipedLines(feed("first\nsecond\nthird\n"));
  // The exact shape of the old bug: let the stream fully drain (and close) before the first read.
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(await next(), "first");
  assert.equal(await next(), "second");
  assert.equal(await next(), "third");
  assert.equal(await next(), null, "EOF reports null so the caller stops instead of hanging");
});

test("a reader waiting before input arrives still gets its line", async () => {
  const rl = createInterface({ input: new Readable({ read() {} }) as any });
  const next = pipedLines(rl);
  const pending = next(); // ask FIRST, then deliver
  rl.emit("line", "later");
  assert.equal(await pending, "later");
});

test("EOF releases every waiter rather than hanging the process", async () => {
  const rl = createInterface({ input: new Readable({ read() {} }) as any });
  const next = pipedLines(rl);
  const a = next(), b = next();
  rl.emit("close");
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
});

test("interleaved reads and arrivals preserve order", async () => {
  const next = pipedLines(feed("a\nb\n"));
  const [x, y] = [await next(), await next()];
  assert.deepEqual([x, y], ["a", "b"]);
});
