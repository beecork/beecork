// Mid-turn steering: the pure injection logic. The raw-mode capture/echo is thin IO (untested, like
// the line editor). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySteering } from "./agent";
import type { Message, ImagePart } from "./types";

test("applySteering: empty notes → unchanged", () => {
  const msgs: Message[] = [{ role: "user", content: "hi" }];
  assert.equal(applySteering(msgs, []), msgs); // same reference, no work
});

test("applySteering: after a tool group → appends ONE user message, pairing intact", () => {
  const msgs: Message[] = [
    { role: "user", content: "do X" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "read_file", arguments: "{}" } }] },
    { role: "tool", content: "result", tool_call_id: "c1" },
  ];
  const out = applySteering(msgs, ["also do Y"]);
  assert.equal(out.length, 4);
  assert.equal(out[3].role, "user");
  assert.match(String(out[3].content), /also do Y/);
  assert.match(String(out[3].content), /while you were working/); // preamble present
  // the assistant(tool_calls) → tool group is untouched (never split)
  assert.equal(out[1].role, "assistant");
  assert.equal(out[2].role, "tool");
});

test("applySteering: multiple notes joined into one message", () => {
  const out = applySteering([{ role: "tool", content: "r", tool_call_id: "c" }], ["note A", "note B"]);
  const last = out[out.length - 1];
  assert.equal(last.role, "user");
  assert.match(String(last.content), /note A\nnote B/);
});

test("applySteering: tail already a user message → merged, no double-user", () => {
  const msgs: Message[] = [{ role: "user", content: "original" }];
  const out = applySteering(msgs, ["steer"]);
  assert.equal(out.length, 1); // merged, not appended
  assert.equal(out[0].role, "user");
  assert.match(String(out[0].content), /original/);
  assert.match(String(out[0].content), /steer/);
});

test("applySteering appends to a multi-part user message without destroying the image", () => {
  // The synthesized image message IS the last message when the next step begins, so the old
  // `${last.content}` concatenation would have produced "[object Object]" and eaten the image.
  const png: ImagePart = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };
  const msgs: Message[] = [{ role: "user", attached: true, content: [{ type: "text", text: "here" }, png] }];
  const out = applySteering(msgs, ["also check the header"]);
  const parts = out[0].content as any[];
  assert.equal(Array.isArray(parts), true);
  assert.equal(parts.filter((p) => p.type === "image_url").length, 1, "the image survives");
  assert.match(parts[parts.length - 1].text, /also check the header/);
  assert.doesNotMatch(JSON.stringify(out), /\[object Object\]/);
});
