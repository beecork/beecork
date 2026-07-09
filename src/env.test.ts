// The runtime-context formatter is pure — the gathering (git/rg probes) is best-effort IO and not
// unit-tested. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatRuntimeContext } from "./env";

test("formatRuntimeContext renders the environment block from facts", () => {
  const out = formatRuntimeContext({
    date: "2026-07-09",
    cwd: "/work/proj",
    platform: "darwin arm64",
    node: "v22.0.0",
    git: "branch main (3 uncommitted changes)",
    ripgrep: true,
  });
  assert.match(out, /^# Environment$/m);
  assert.match(out, /Date: 2026-07-09/);
  assert.match(out, /Working directory: \/work\/proj/);
  assert.match(out, /Git: branch main \(3 uncommitted changes\)/);
  assert.match(out, /ripgrep \(rg\): available/);
  // ripgrep=false renders "not installed"
  assert.match(formatRuntimeContext({ date: "d", cwd: "c", platform: "p", node: "n", git: "g", ripgrep: false }), /ripgrep \(rg\): not installed/);
});
