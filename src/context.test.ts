// Compaction cut-point + token estimate (the pure, correctness-critical bits). A wrong cut would
// split an assistant→tool group → invalid provider request / corrupted /resume. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { compactionStart, estimateTokens } from "./context";
import type { Message } from "./types";

const sys: Message = { role: "system", content: "sys" };
const u = (c = "u"): Message => ({ role: "user", content: c });
const a = (c = "a"): Message => ({ role: "assistant", content: c });
const asstCall: Message = { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] };
const tool: Message = { role: "tool", content: "result", tool_call_id: "c1" };

test("compactionStart snaps the cut back to a USER message (never splits a tool group)", () => {
  //          0    1    2         3     4    5         6     7    8
  const m: Message[] = [sys, u(), asstCall, tool, u(), asstCall, tool, u(), a()];
  const start = compactionStart(m, 3); // 9-3=6 → m[6]=tool → snap back past the group to m[4]=user
  assert.equal(start, 4);
  assert.equal(m[start].role, "user"); // recent begins at a user boundary → group m[5..6] stays intact
});

test("compactionStart clamps keepRecent=0 (no OOB) and a huge keepRecent (returns 1)", () => {
  const m: Message[] = [sys, u(), a(), u(), a()];
  assert.ok(compactionStart(m, 0) <= m.length - 1, "never indexes messages[length]");
  assert.equal(compactionStart(m, 999), 1); // keep everything → nothing old enough → caller no-ops on <=1
});

test("compactionStart: a cut already on a user message doesn't move", () => {
  const m: Message[] = [sys, u("a"), u("b"), u("c")];
  assert.equal(compactionStart(m, 1), 3); // m[3] is already a user
});

test("estimateTokens counts content + tool_calls JSON at ~4 chars/token", () => {
  assert.equal(estimateTokens([{ role: "user", content: "12345678" }]), 2); // 8 chars / 4
  assert.ok(estimateTokens([asstCall]) > 0); // tool_calls JSON counted even when content is null
});
