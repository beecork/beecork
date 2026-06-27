// Tests for the `show` tagged-payload protocol (builder ↔ renderShow). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { showPayload, renderShow } from "./show";

test("file payload round-trips to a rendered box + a model note", () => {
  const r = renderShow(showPayload("file", { path: "a.ts", startLine: 1, lines: ["x", "y"], hasMore: true }));
  assert.ok(r, "parsed");
  assert.ok(r!.display.includes("a.ts"), "header shows the path");
  assert.ok(r!.display.includes("x") && r!.display.includes("y"), "content shown");
  assert.ok(r!.note.includes("a.ts") && /do not/i.test(r!.note), "note tells the model not to repeat it");
});

test("dir and tree payloads render", () => {
  assert.ok(renderShow(showPayload("dir", { path: ".", names: ["a/", "b"] }))!.display.includes("a/"));
  const tree = renderShow(showPayload("tree", { path: ".", items: [{ prefix: "", name: "a", isDir: false }], truncated: false }));
  assert.ok(tree!.display.includes("a"));
});

test("non-tagged or malformed input returns null (caller shows raw)", () => {
  assert.equal(renderShow("just some text"), null);
  assert.equal(renderShow("\x01file\x01{not valid json"), null);
});
