// Background-task tests: the pure rolling-buffer/cursor helpers, and a real spawned command through
// start → check → exit → stop. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendTail, readSince, startTask, checkTask, stopTask, runningTaskCount, killAllTasks } from "./tasks";

test("appendTail keeps the last `cap` chars and flags drops", () => {
  assert.deepEqual(appendTail("", "abc", 10), { buffer: "abc", dropped: false });
  assert.deepEqual(appendTail("abcde", "fg", 10), { buffer: "abcdefg", dropped: false });
  // overflow → keep the LAST cap chars, dropped=true
  assert.deepEqual(appendTail("abcdefgh", "ij", 5), { buffer: "fghij", dropped: true });
});

test("readSince returns only output produced since the last cursor", () => {
  // buffer holds the full tail; nothing read yet
  assert.deepEqual(readSince("hello", 5, 0), { output: "hello", dropped: false });
  // read up to 3 → only the last 2 chars are new
  assert.deepEqual(readSince("hello", 5, 3), { output: "lo", dropped: false });
  // nothing new
  assert.deepEqual(readSince("hello", 5, 5), { output: "", dropped: false });
  // more new output than the tail retained → whole buffer + dropped
  assert.deepEqual(readSince("xyz", 100, 0), { output: "xyz", dropped: true });
});

test("startTask → checkTask → exit; and unknown ids error", async () => {
  const { id, error } = startTask("printf hello; exit 0");
  assert.ok(id && !error);
  // wait for it to finish
  await new Promise((r) => setTimeout(r, 300));
  const out = checkTask(id!);
  assert.match(out, /exited/i);
  assert.match(out, /hello/);
  // a second check → no NEW output (cursor advanced)
  assert.match(checkTask(id!), /no new output/i);
  // unknown ids → Error contract
  assert.match(checkTask("bg_nope"), /^Error/);
  assert.match(stopTask("bg_nope"), /^Error/);
});

test("stopTask kills a running task and killAllTasks clears the registry", async () => {
  const { id } = startTask("sleep 30");
  assert.ok(id);
  assert.ok(runningTaskCount() >= 1);
  const stopped = stopTask(id!);
  assert.match(stopped, /Stopped/);
  assert.match(checkTask(id!), /exited|already exited/i);
  // killAllTasks is a no-op-safe sweep (nothing left running from this test)
  killAllTasks();
});
