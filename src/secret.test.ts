// Regression tests for the secret-file gate (H2). It must (a) match on the CANONICAL resolved
// path so an in-root symlink can't slip a secret past it, and (b) cover the real secret filenames.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readGuard, writeGuard, SECRET_FILE } from "./safety";
import { projectRoot } from "./paths";

// A scratch dir INSIDE the project root (resolveInRoot confines to cwd = projectRoot in tests).
const dir = join(projectRoot, ".secret-gate-test");
const rel = ".secret-gate-test";

test("secret-file gate resolves symlinks + covers real secret names", (t) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "id_rsa"), "PRIVATE KEY");
  writeFileSync(join(dir, "plain.txt"), "hello");
  symlinkSync("id_rsa", join(dir, "notes.txt")); // innocuously-named symlink → a real secret
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Direct secret name → gated.
  assert.equal(readGuard({ path: `${rel}/id_rsa` }).needsApproval, true);
  // The symlink whose NAME isn't secret but which RESOLVES to a secret → still gated (the bug).
  assert.equal(readGuard({ path: `${rel}/notes.txt` }).needsApproval, true);
  // A genuinely plain file → not gated.
  assert.equal(readGuard({ path: `${rel}/plain.txt` }).needsApproval ?? false, false);
  // Writes/edits are gated the same way (M1) — a planted .npmrc / overwritten key is dangerous too.
  assert.equal(writeGuard({ path: `${rel}/id_rsa` }).needsApproval, true);
  assert.equal(writeGuard({ path: `${rel}/notes.txt` }).needsApproval, true);
});

test("SECRET_FILE pattern covers common secret filenames", () => {
  for (const name of [
    ".env", ".env.local", ".env.production", "prod.env", "config.env", // dotfile AND *.env non-dotfiles
    "id_rsa", "id_ed25519", "server.pem", "app.key", "signing.secret",
    "credentials", ".npmrc", ".netrc", ".git-credentials", ".pgpass",
    "cert.pfx", "store.p12", "keystore.jks", "my.keystore",
  ]) {
    assert.ok(SECRET_FILE.test(name) || SECRET_FILE.test("/some/dir/" + name), `should match secret: ${name}`);
  }
  for (const name of ["index.ts", "README.md", "notes.txt", "package.json", "environment.ts"]) {
    assert.equal(SECRET_FILE.test(name), false, `should NOT match: ${name}`);
  }
});
