// Image plumbing. The load-bearing assertion here is that textOf NEVER emits a data URL — that is
// what keeps a megabyte of base64 out of the compaction summarizer, the session files, and the
// /resume picker. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffImage, dataUrl, imagePart, describePart, textOf, imageCount, splitResult, buildAttachmentMessage, stripImagesForSave, pruneOldImages } from "./images";
import { config } from "./config";
import type { ImagePart, Message } from "./types";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 9]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 7]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from([1, 2])]);
const png = (): ImagePart => imagePart("image/png", PNG);

test("sniffImage identifies by magic bytes, and refuses anything else", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(GIF), "image/gif");
  assert.equal(sniffImage(WEBP), "image/webp");
  assert.equal(sniffImage(Buffer.from("this is just some text, honestly")), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
  assert.equal(sniffImage(Buffer.from("short")), null);
  // RIFF that isn't WEBP (e.g. a .wav) must not pass as an image.
  assert.equal(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"), Buffer.from([1, 2])])), null);
});

test("dataUrl / describePart round-trip the mime and byte size", () => {
  const url = dataUrl("image/png", PNG);
  assert.ok(url.startsWith("data:image/png;base64,"));
  const d = describePart(png());
  assert.equal(d.mime, "image/png");
  assert.equal(d.bytes, PNG.length);
});

test("textOf renders an image as a description and NEVER as a data URL", () => {
  assert.equal(textOf("hello"), "hello");
  assert.equal(textOf(null), "");
  const out = textOf([{ type: "text", text: "look:" }, png()]);
  assert.match(out, /^look:/);
  assert.match(out, /\[image: image\/png, \d+ KB\]/);
  // The whole point: nothing downstream can leak base64 through this path.
  assert.doesNotMatch(out, /base64,/);
  assert.equal(imageCount([{ type: "text", text: "x" }, png(), png()]), 2);
  assert.equal(imageCount("plain"), 0);
});

test("splitResult normalizes both ToolResult shapes", () => {
  assert.deepEqual(splitResult("hi"), { text: "hi", images: [] });
  const r = splitResult({ text: "shot", images: [png()] });
  assert.equal(r.text, "shot");
  assert.equal(r.images.length, 1);
});

test("buildAttachmentMessage produces one flagged user message, text part first", () => {
  assert.equal(buildAttachmentMessage([]), null);
  const m = buildAttachmentMessage([{ part: png(), tool: "read_file" }, { part: png(), tool: "mcp__pw__screenshot" }])!;
  assert.equal(m.role, "user");
  assert.equal(m.attached, true, "must be flagged, or pruneReasoningForSend mistakes it for a new turn");
  const parts = m.content as any[];
  assert.equal(parts[0].type, "text", "text leads, per OpenRouter's multi-part guidance");
  assert.match(parts[0].text, /read_file/);
  assert.equal(parts.filter((p) => p.type === "image_url").length, 2);
});

test("buildAttachmentMessage caps images per step and says how many it dropped", () => {
  const many = Array.from({ length: config.maxImagesPerMessage + 3 }, () => ({ part: png(), tool: "t" }));
  const parts = buildAttachmentMessage(many)!.content as any[];
  assert.equal(parts.filter((p) => p.type === "image_url").length, config.maxImagesPerMessage);
  assert.match(parts[0].text, /dropped/);
});

test("stripImagesForSave removes payloads, keeps structure, and collapses to a string", () => {
  const msgs: Message[] = [
    { role: "user", attached: true, content: [{ type: "text", text: "see" }, png()] },
    { role: "assistant", content: "ok" },
  ];
  const saved = stripImagesForSave(msgs);
  assert.equal(saved.length, 2, "message count is preserved");
  assert.equal(typeof saved[0].content, "string", "an all-text parts array collapses back to a string");
  assert.doesNotMatch(JSON.stringify(saved), /base64,/, "no base64 may reach a session file");
  assert.equal(saved[0].attached, undefined, "internal flag is not persisted");
  assert.equal(saved[1].content, "ok");
});

test("pruneOldImages keeps the newest N and preserves message count + roles", () => {
  const msgs: Message[] = [
    { role: "user", content: [{ type: "text", text: "a" }, png()] },
    { role: "assistant", content: null, tool_calls: [{ id: "1", type: "function", function: { name: "x", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "1", content: "res" },
    { role: "user", content: [{ type: "text", text: "b" }, png()] },
  ];
  const out = pruneOldImages(msgs, 1);
  assert.equal(out.length, msgs.length);
  assert.deepEqual(out.map((m) => m.role), msgs.map((m) => m.role), "tool pairing must survive");
  assert.equal(imageCount(out[0].content), 0, "the older image is replaced");
  assert.equal(imageCount(out[3].content), 1, "the newest is kept");
  assert.match(textOf(out[0].content), /dropped from context/);
  // Under the limit → untouched (identity, so callers can rely on no needless copying).
  assert.equal(pruneOldImages(msgs, 10), msgs);
});
