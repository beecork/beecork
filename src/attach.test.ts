// @-attachment parsing. The highest-value assertions here are the NEGATIVE ones: "@types/node" and
// "@src/index.ts" are ordinary text a developer types constantly, and mangling them would be a far
// worse regression than the feature is worth. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractAttachments, loadImage } from "./attach";
import { config } from "./config";

test("extractAttachments pulls image refs out and leaves the prose", () => {
  assert.deepEqual(extractAttachments("here's the mockup, build this @design/mockup.png"), {
    text: "here's the mockup, build this",
    refs: ["design/mockup.png"],
  });
  assert.deepEqual(extractAttachments("compare @a.png and @b.jpg please"), {
    text: "compare and please",
    refs: ["a.png", "b.jpg"],
  });
});

test("a NON-image @token is left completely alone", () => {
  for (const line of ["install @types/node", "ping @user about it", "look at @src/index.ts", "email a@b.com"]) {
    const r = extractAttachments(line);
    assert.deepEqual(r.refs, [], `${line} must not be treated as an attachment`);
    assert.equal(r.text, line, `${line} must survive verbatim`);
  }
});

test("quoted paths with spaces work", () => {
  assert.deepEqual(extractAttachments('check @"my folder/a b.png" now'), { text: "check now", refs: ["my folder/a b.png"] });
  assert.deepEqual(extractAttachments("check @'my folder/a b.png'"), { text: "check", refs: ["my folder/a b.png"] });
});

test("a bare dragged-in path is treated as one attachment with no text", () => {
  // What a macOS terminal actually delivers on drag-and-drop: quoted, or backslash-escaped.
  assert.deepEqual(extractAttachments("'/Users/me/Desktop/Screen Shot.png'"), { text: "", refs: ["/Users/me/Desktop/Screen Shot.png"] });
  assert.deepEqual(extractAttachments("/Users/me/Desktop/Screen\\ Shot.png"), { text: "", refs: ["/Users/me/Desktop/Screen Shot.png"] });
  assert.deepEqual(extractAttachments("/Users/me/shot.png"), { text: "", refs: ["/Users/me/shot.png"] });
  // Prose that merely mentions a png is NOT a drag-and-drop.
  assert.deepEqual(extractAttachments("the file shot.png is broken").refs, []);
});

test("refs are capped per message", () => {
  const line = Array.from({ length: config.maxImagesPerMessage + 4 }, (_, i) => `@x${i}.png`).join(" ");
  assert.equal(extractAttachments(line).refs.length, config.maxImagesPerMessage);
});

test("loadImage validates by magic bytes, not by extension", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bk-att-"));
  const real = join(dir, "real.png");
  const fake = join(dir, "fake.png");
  await writeFile(real, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1]));
  await writeFile(fake, "I am plain text wearing a .png hat");

  const ok = await loadImage(real);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.mime, "image/png");
    assert.ok(ok.part.image_url.url.startsWith("data:image/png;base64,"));
  }

  const bad = await loadImage(fake);
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.match(bad.reason, /not a PNG/);

  const missing = await loadImage(join(dir, "nope.png"));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.reason, /not found/);
});
