// Per-project site binding: read_dev_signals scopes the shared inbox to the folder you're in, using
// origins remembered in <cwd>/.beecork/skeleton.json. These test origin normalization (the URL parser
// has a trap for bare host:port) and the load/add persistence. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toOrigin, loadProjectOrigins, addProjectOrigin } from "./projectSites";

test("toOrigin: normalizes URLs + bare host:port, rejects junk (no 'null' origin leak)", () => {
  assert.equal(toOrigin("https://app.example.com/checkout?x=1"), "https://app.example.com");
  assert.equal(toOrigin("http://localhost:8000"), "http://localhost:8000");
  assert.equal(toOrigin("localhost:8000"), "http://localhost:8000"); // bare host:port, NOT scheme "localhost:"
  assert.equal(toOrigin("app.example.com"), "http://app.example.com");
  assert.equal(toOrigin("not a url"), ""); // space → unparseable
  assert.equal(toOrigin(""), "");
});

test("loadProjectOrigins empty when unset; addProjectOrigin persists, normalizes, dedups", async () => {
  const saved = process.cwd();
  const proj = await mkdtemp(join(tmpdir(), "bk-sites-"));
  try {
    process.chdir(proj);
    assert.deepEqual(await loadProjectOrigins(), []); // no config yet → unbound

    assert.equal(await addProjectOrigin("https://app.example.com/foo"), true);  // stored as origin only
    assert.equal(await addProjectOrigin("https://app.example.com/bar"), false); // same origin → no-op
    assert.equal(await addProjectOrigin("localhost:8000"), true);               // bare host:port accepted
    assert.equal(await addProjectOrigin("garbage url"), false);                 // junk → not stored

    assert.deepEqual(await loadProjectOrigins(), ["https://app.example.com", "http://localhost:8000"]);
    const raw = JSON.parse(await readFile(join(proj, ".beecork", "skeleton.json"), "utf8"));
    assert.deepEqual(raw.origins, ["https://app.example.com", "http://localhost:8000"]);
  } finally {
    process.chdir(saved);
  }
});
