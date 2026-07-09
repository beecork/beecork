// Per-project site binding: read_dev_signals scopes the shared inbox to the folder you're in, using
// origins remembered in <cwd>/.beecork/skeleton.json. These test origin normalization (the URL parser
// has a trap for bare host:port) and the load/add persistence. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toOrigin, isLoopbackOrigin, loadProjectOrigins, addProjectOrigin } from "./projectSites";

test("toOrigin: normalizes URLs + bare host:port, rejects junk (no 'null' origin leak)", () => {
  assert.equal(toOrigin("https://app.example.com/checkout?x=1"), "https://app.example.com");
  assert.equal(toOrigin("http://localhost:8000"), "http://localhost:8000");
  assert.equal(toOrigin("localhost:8000"), "http://localhost:8000"); // bare host:port, NOT scheme "localhost:"
  assert.equal(toOrigin("app.example.com"), "http://app.example.com");
  assert.equal(toOrigin("not a url"), ""); // space → unparseable
  assert.equal(toOrigin(""), "");
});

test("isLoopbackOrigin: localhost/loopback are ephemeral (not stable project IDs)", () => {
  for (const l of ["http://localhost:8000", "localhost:3000", "http://127.0.0.1:5000", "http://[::1]:9000", "http://0.0.0.0:8080", "http://app.localhost:3000"])
    assert.equal(isLoopbackOrigin(l), true, l);
  for (const p of ["https://app.example.com", "http://192.168.1.5:3000", "https://staging.foo.com"])
    assert.equal(isLoopbackOrigin(p), false, p);
});

test("loadProjectOrigins empty when unset; addProjectOrigin persists PUBLIC origins, never localhost", async () => {
  const saved = process.cwd();
  const proj = await mkdtemp(join(tmpdir(), "bk-sites-"));
  try {
    process.chdir(proj);
    assert.deepEqual(await loadProjectOrigins(), []); // no config yet → unbound

    assert.equal(await addProjectOrigin("https://app.example.com/foo"), true);  // stored as origin only
    assert.equal(await addProjectOrigin("https://app.example.com/bar"), false); // same origin → no-op
    assert.equal(await addProjectOrigin("http://localhost:8000"), false);       // localhost → NEVER persisted
    assert.equal(await addProjectOrigin("127.0.0.1:5000"), false);              // loopback → NEVER persisted
    assert.equal(await addProjectOrigin("garbage url"), false);                 // junk → not stored

    assert.deepEqual(await loadProjectOrigins(), ["https://app.example.com"]); // only the stable public one
    const raw = JSON.parse(await readFile(join(proj, ".beecork", "skeleton.json"), "utf8"));
    assert.deepEqual(raw.origins, ["https://app.example.com"]);
  } finally {
    process.chdir(saved);
  }
});
