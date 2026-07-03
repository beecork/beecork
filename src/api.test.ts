// Regression tests for the SSE parse step (the choke point for every model interaction) and the
// transient-status classifier that decides whether a stream error retries. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSSELine, isTransientStatus } from "./api";

test("parseSSELine classifies content / tool_call / error / done / ignore", () => {
  // Content delta.
  assert.deepEqual(parseSSELine('data: {"choices":[{"delta":{"content":"hi"}}]}'), { content: "hi" });
  // Tool-call delta (deltas passed through for reassembly).
  const tc = parseSSELine('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{"}}]}}]}');
  assert.ok(tc?.toolCalls && tc.toolCalls[0].function.name === "read_file");
  // A delta carrying BOTH content and tool_calls keeps both (behavior preserved).
  const both = parseSSELine('data: {"choices":[{"delta":{"content":"x","tool_calls":[{"index":0}]}}]}');
  assert.equal(both?.content, "x");
  assert.ok(both?.toolCalls);
  // Error object with a numeric code → surfaced with the code (drives the transient retry).
  assert.deepEqual(parseSSELine('data: {"error":{"message":"rate limited","code":429}}'), { error: "rate limited", errorCode: 429 });
  // Error given as a bare string.
  assert.deepEqual(parseSSELine('data: {"error":"boom"}'), { error: "boom", errorCode: undefined });
  // Ignored lines → null.
  assert.equal(parseSSELine("data: [DONE]"), null);
  assert.equal(parseSSELine(": keep-alive comment"), null);
  assert.equal(parseSSELine("event: ping"), null);
  assert.equal(parseSSELine("data: {not json"), null);
  // A delta with neither content nor tool_calls → empty (no-op), not null.
  assert.deepEqual(parseSSELine('data: {"choices":[{"delta":{}}]}'), {});
});

test("isTransientStatus flags 429 + 5xx only", () => {
  for (const s of [429, 500, 502, 503, 504]) assert.equal(isTransientStatus(s), true, `${s} transient`);
  for (const s of [200, 400, 401, 403, 404]) assert.equal(isTransientStatus(s), false, `${s} not transient`);
});
