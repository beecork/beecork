// Tests for path confinement. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectRoot, resolveInRoot } from "./paths";

test("in-root paths are allowed", () => {
  assert.equal(resolveInRoot(".").inRoot, true);
  assert.equal(resolveInRoot("src/paths.ts").inRoot, true);
  assert.equal(resolveInRoot("src/../package.json").inRoot, true); // a `..` that stays inside
  assert.equal(resolveInRoot("a-file-that-does-not-exist-yet.txt").inRoot, true); // new file in root
});

test("`..` escapes are flagged out-of-root", () => {
  assert.equal(resolveInRoot("..").inRoot, false);
  assert.equal(resolveInRoot("../../etc/passwd").inRoot, false);
});

test("absolute paths outside the root are flagged", () => {
  assert.equal(resolveInRoot("/etc/passwd").inRoot, false);
  assert.equal(resolveInRoot(join(tmpdir(), "x")).inRoot, false);
});

test("symlink escapes are flagged out-of-root", () => {
  // A symlink INSIDE the project that points OUTSIDE must not be a way out.
  const linkDir = join(projectRoot, ".tmp-symlink-test");
  try {
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(tmpdir(), join(linkDir, "escape"));
    assert.equal(resolveInRoot(join(".tmp-symlink-test", "escape", "secret")).inRoot, false);
  } finally {
    rmSync(linkDir, { recursive: true, force: true });
  }
});
