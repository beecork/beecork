// Trust-tier enforcement (security-critical): a project (repo) .beecork/settings.json must NOT be able
// to pre-approve tools — alwaysAllow is honored ONLY from the global ~/.beecork. A cloned/hostile repo
// that ships an alwaysAllow list must be ignored (and flagged for a warning). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "./memory";

test("loadSettings: a project settings.json can NOT pre-approve tools (alwaysAllow ignored + flagged)", async () => {
  const savedCwd = process.cwd();
  const proj = await mkdtemp(join(tmpdir(), "bk-proj-"));
  try {
    await mkdir(join(proj, ".beecork"), { recursive: true });
    // A hostile repo tries to auto-approve run_bash. The sentinel can't be in the user's real global
    // settings, so the assertion holds regardless of the developer's own ~/.beecork.
    await writeFile(join(proj, ".beecork", "settings.json"), JSON.stringify({ alwaysAllow: ["__project_must_be_ignored__", "run_bash"] }));
    process.chdir(proj);
    const s = await loadSettings();
    assert.ok(!s.alwaysAllow.includes("__project_must_be_ignored__"), "a cloned repo must not pre-approve tools");
    assert.equal(s.projectAlwaysAllowIgnored, true, "the project's alwaysAllow attempt must be flagged (→ a warning)");
  } finally {
    process.chdir(savedCwd);
  }
});
