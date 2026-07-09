// Regression tests for the SSE parse step (the choke point for every model interaction) and the
// transient-status classifier that decides whether a stream error retries. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSSELine, isTransientStatus, buildRequestBody, pruneReasoningForSend } from "./api";
import type { Message } from "./types";

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

test("parseSSELine surfaces reasoning deltas (plaintext + structured)", () => {
  assert.deepEqual(parseSSELine('data: {"choices":[{"delta":{"reasoning":"hmm"}}]}'), { reasoning: "hmm" });
  const d = parseSSELine('data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"step"}]}}]}');
  assert.ok(d?.reasoningDetails && d.reasoningDetails[0].text === "step");
  // A pure empty reasoning string is not surfaced (stays a no-op {}).
  assert.deepEqual(parseSSELine('data: {"choices":[{"delta":{"reasoning":""}}]}'), {});
});

test("buildRequestBody wires reasoning by effort + gating", () => {
  const base = { model: "m", messages: [] as Message[], includeTools: false, extra: {} };
  // Supported + a level → unified effort field.
  assert.deepEqual(buildRequestBody({ ...base, effort: "high", reasoningSupported: true }).reasoning, { effort: "high" });
  // "off" actively disables thinking (even on models that default it on).
  assert.deepEqual(buildRequestBody({ ...base, effort: "off", reasoningSupported: true }).reasoning, { enabled: false });
  // Not supported → no reasoning field at all (avoids a 400).
  assert.equal("reasoning" in buildRequestBody({ ...base, effort: "high", reasoningSupported: false }), false);
});

test("buildRequestBody: escape hatch tunes sampling but can't break structural fields", () => {
  const body = buildRequestBody({
    model: "m", messages: [{ role: "user", content: "hi" }], includeTools: true,
    effort: "medium", reasoningSupported: true,
    extra: { temperature: 0.2, model: "HACK", messages: "HACK", stream: false },
  });
  assert.equal(body.temperature, 0.2); // sampling passes through
  assert.equal(body.model, "m"); // structural fields always win over extra
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
  assert.ok(body.tools); // includeTools honored
});

test("buildRequestBody: tools override (sub-agent) vs default global TOOLS", () => {
  const base = { model: "m", messages: [] as Message[], includeTools: true, effort: "off" as const, reasoningSupported: false, extra: {} };
  const custom = [{ type: "function", function: { name: "read_file", description: "", parameters: {} } }];
  assert.deepEqual(buildRequestBody({ ...base, tools: custom }).tools, custom); // restricted set used verbatim
  assert.ok(Array.isArray(buildRequestBody(base).tools)); // omitted → falls back to the global TOOLS
});

test("buildRequestBody: extra.reasoning overrides the effort default", () => {
  const body = buildRequestBody({
    model: "m", messages: [], includeTools: false, effort: "high", reasoningSupported: true,
    extra: { reasoning: { max_tokens: 5000 } },
  });
  assert.deepEqual(body.reasoning, { max_tokens: 5000 });
});

test("pruneReasoningForSend keeps reasoning only on the current turn's trailing chain", () => {
  const msgs: Message[] = [
    { role: "system", content: "s" },
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1", reasoning: "old-think" }, // past turn → stripped
    { role: "user", content: "u2" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read", arguments: "{}" } }], reasoning: "cur-think", reasoning_details: [{ type: "reasoning.text", text: "t" }] }, // current turn → kept
    { role: "tool", content: "result", tool_call_id: "c1" },
  ];
  const out = pruneReasoningForSend(msgs);
  assert.equal(out[2].reasoning, undefined, "past-turn reasoning stripped");
  assert.equal(out[4].reasoning, "cur-think", "current-turn reasoning kept");
  assert.ok(out[4].reasoning_details, "current-turn reasoning_details kept");
  // original history is untouched (pure)
  assert.equal(msgs[2].reasoning, "old-think");
});
