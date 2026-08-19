// OS sandbox: profile construction, the fail-closed decision, and — where the platform supports it —
// a REAL end-to-end check that the kernel actually refuses a write outside the workspace.
//
// The profile tests are the important ones to keep honest: a sandbox that silently permits
// everything still passes "the command ran", so the assertions here are about what it REFUSES.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { seatbeltProfile, bubblewrapArgs, wrapCommand, unconfinedNotice, resetSandboxForTests, protectedPaths, probeSandbox } from "./sandbox";
import { projectRoot } from "./paths";
import { config } from "./config";
import type { Mode } from "./state";

const run = (cmd: string, args: string[]): Promise<{ code: number; stderr: string }> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 10_000 }, (err, _out, stderr) =>
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, stderr: String(stderr) }),
    ),
  );

test("seatbelt profile: denies writes globally, then re-opens only the workspace and temp", () => {
  const p = seatbeltProfile("normal");
  assert.match(p, /^\(version 1\)/);
  assert.match(p, /\(deny file-write\*\)/, "the whole point: writes are denied by default");
  assert.ok(p.includes(`(subpath "${projectRoot}")`), "the workspace is writable");
  // Reads are deliberately NOT jailed — a coding agent has to read its toolchain.
  assert.doesNotMatch(p, /deny file-read/, "reads stay open by design");
});

test("seatbelt profile: read-only and plan mode grant NO writable roots at all", () => {
  for (const mode of ["readonly", "plan"] as const) {
    const p = seatbeltProfile(mode);
    assert.ok(!p.includes(`(subpath "${projectRoot}")`), `${mode} must not make the workspace writable`);
    assert.match(p, /\(deny file-write\*\)/);
    assert.match(p, /dev\/null/, "the process's own plumbing still works, or nothing runs at all");
  }
});

test("seatbelt profile: a path with a quote can't break out of the string literal", () => {
  // Not reachable today (projectRoot is a real directory), but a profile assembled by string
  // concatenation is exactly where an injection would live, so pin the escaping.
  const p = seatbeltProfile("normal");
  const literals = p.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  assert.ok(literals.length > 0);
  for (const l of literals) {
    const inner = l.slice(1, -1).replace(/\\\\/g, "").replace(/\\"/g, "");
    assert.doesNotMatch(inner, /"/, `unescaped quote inside ${l}`);
  }
});

// Is `p` bound READ-WRITE (a real --bind-try triple), rather than merely appearing somewhere in argv?
const rwBindIndex = (argv: string[], p: string): number =>
  argv.findIndex((a, i) => a === "--bind-try" && argv[i + 1] === p && argv[i + 2] === p);

test("bubblewrap args: the workspace is bound READ-WRITE, not merely mentioned", () => {
  const normal = bubblewrapArgs("normal");
  assert.match(normal.join(" "), /--ro-bind \/ \//, "everything starts read-only");
  // NOT `.includes(projectRoot)`: `--chdir projectRoot` puts that string in argv even with every
  // writable bind deleted, so the old assertion passed against a sandbox that granted nothing.
  // Proved by mutation — deleting the whole bind loop left all 16 tests green.
  assert.ok(rwBindIndex(normal, projectRoot) >= 0, "the workspace must be bound rw");

  const ro = bubblewrapArgs("readonly");
  assert.match(ro.join(" "), /--ro-bind \/ \//);
  assert.ok(!ro.includes("--bind-try"), "read-only mode binds nothing writable");
  assert.ok(ro.includes(projectRoot), "…though --chdir still names it — which is why includes() proves nothing");
});

test("bubblewrap args: credentials are re-bound read-only AFTER every writable root", () => {
  // The Linux half of the "deny credentials LAST" guarantee. Nothing tested it: sandbox.test.ts only
  // inspected the SEATBELT string, so deleting bubblewrap's trailing re-deny loop also left all 16
  // tests green — and on Linux ~/.ssh could have become writable unnoticed.
  const argv = bubblewrapArgs("normal");
  const lastWritable = argv.lastIndexOf("--bind-try");
  assert.ok(lastWritable >= 0, "there must be writable roots to re-deny after");
  for (const p of protectedPaths()) {
    const i = argv.findIndex((a, k) => a === "--ro-bind-try" && argv[k + 1] === p && argv[k + 2] === p);
    assert.ok(i >= 0, `${p} must be re-bound read-only`);
    assert.ok(i > lastWritable, `${p} must be re-bound AFTER the writable roots — bwrap applies binds in argv order`);
  }
});

test("wrapCommand: an active runner replaces the bare shell with the confined form", () => {
  const { spec, refusal } = wrapCommand("echo hi", "normal", { kind: "active", runner: "seatbelt" });
  assert.equal(refusal, undefined);
  assert.equal(spec.cmd, "/usr/bin/sandbox-exec");
  assert.equal(spec.shell, false, "shell:true would hand the command to a shell OUTSIDE the sandbox");
  assert.deepEqual(spec.args.slice(-3), ["/bin/sh", "-c", "echo hi"]);
});

test("wrapCommand under BEECORK_SANDBOX=on REFUSES when no runner is available", () => {
  const prev = config.sandboxMode;
  config.sandboxMode = "on";
  try {
    const { refusal } = wrapCommand("echo hi", "normal", { kind: "unavailable", reason: "no bwrap" });
    assert.ok(refusal, "a required sandbox that isn't there must block the command, not run it bare");
    assert.match(refusal!, /no bwrap/, "the diagnostic names the real reason");
    assert.match(refusal!, /BEECORK_SANDBOX=auto/, "and tells the user how to proceed deliberately");
  } finally {
    config.sandboxMode = prev;
  }
});

test("wrapCommand under auto runs bare when unavailable — but says so, ONCE", () => {
  const prev = config.sandboxMode;
  config.sandboxMode = "auto";
  resetSandboxForTests();
  try {
    const status = { kind: "unavailable", reason: "no runner here" } as const;
    const { spec, refusal } = wrapCommand("echo hi", "normal", status);
    assert.equal(refusal, undefined, "auto keeps working on machines without a runner");
    assert.equal(spec.shell, true, "…by running the command as before");

    // "Never SILENTLY unsandboxed" is the requirement — so the first call must warn.
    assert.match(String(unconfinedNotice(status)), /WITHOUT OS sandboxing/);
    assert.equal(unconfinedNotice(status), null, "…and must not nag on every later command");
  } finally {
    config.sandboxMode = prev;
    resetSandboxForTests();
  }
});

// --- the real thing -------------------------------------------------------------------------
// Everything above checks what beecork BUILDS. This checks what the kernel actually ENFORCES,
// which is the only evidence that matters. macOS only; skipped elsewhere rather than faked.

// Gate on CONFINEMENT BEING AVAILABLE, not on platform. The kernel assertions below are the only
// thing that proves the sandbox confines anything, and gating them on macOS meant they ALL skipped on
// the Linux CI runner — where bwrap isn't installed either, so nothing exercised the sandbox at all
// and the suite was green with zero confinement.
const sandbox = await probeSandbox();
const confined = sandbox.kind === "active";

// Run `command` under whatever runner beecork ITSELF would use here. Going through wrapCommand is
// what makes these tests portable AND honest: hardcoding one runner's path made the "refuses"
// assertions pass on a machine without that runner, since ENOENT is also a non-zero exit.
const runConfined = async (command: string, mode: Mode = "normal") => {
  const { spec, refusal } = wrapCommand(command, mode, sandbox);
  assert.equal(refusal, undefined, "wrapCommand must not refuse when confinement IS available");
  assert.equal(spec.shell, false, "a confined command must not be handed to a shell OUTSIDE the sandbox");
  return run(spec.cmd, spec.args);
};

test("REAL (confined): the kernel refuses a write outside the workspace", { skip: !confined }, async () => {
  const outside = join(homedir(), `.beecork-sandbox-probe-${process.pid}`);
  rmSync(outside, { force: true });
  const { code } = await runConfined(`echo escaped > ${JSON.stringify(outside)}`, "normal");
  try {
    assert.notEqual(code, 0, "writing outside the workspace must fail");
    assert.equal(existsSync(outside), false, "and must not leave a file behind");
  } finally {
    rmSync(outside, { force: true });
  }
});

test("REAL (confined): the kernel still allows a write INSIDE the workspace", { skip: !confined }, async () => {
  const inside = join(projectRoot, `.beecork-sandbox-probe-${process.pid}`);
  rmSync(inside, { force: true });
  try {
    const { code, stderr } = await runConfined(`echo ok > ${JSON.stringify(inside)}`, "normal");
    assert.equal(code, 0, `an in-workspace write must still work (stderr: ${stderr})`);
    assert.equal(existsSync(inside), true);
  } finally {
    rmSync(inside, { force: true });
  }
});

test("REAL (confined): a symlink pointing out of the workspace does not become an escape hatch", { skip: !confined }, async () => {
  // This is the case policy parsing cannot catch: the PATH is inside the workspace, so a path check
  // passes, and only the kernel sees where the write actually lands.
  const outsideDir = mkdtempSync(join(tmpdir(), "beecork-escape-"));
  const target = join(outsideDir, "loot.txt");
  const link = join(projectRoot, `.beecork-escape-link-${process.pid}`);
  rmSync(link, { force: true });
  try {
    await run("/bin/ln", ["-s", outsideDir, link]);
    // The temp dir IS writable by design, so point the probe somewhere that never is.
    const homeTarget = join(homedir(), `.beecork-escape-${process.pid}`);
    const homeLink = join(projectRoot, `.beecork-home-link-${process.pid}`);
    rmSync(homeLink, { force: true });
    rmSync(homeTarget, { force: true });
    await run("/bin/ln", ["-s", homedir(), homeLink]);

    const { code } = await runConfined(`echo escaped > ${JSON.stringify(join(homeLink, `.beecork-escape-${process.pid}`))}`, "normal");
    assert.notEqual(code, 0, "a write through an in-workspace symlink must still be judged by its DESTINATION");
    assert.equal(existsSync(homeTarget), false);
    rmSync(homeLink, { force: true });
    rmSync(homeTarget, { force: true });
  } finally {
    rmSync(link, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
    rmSync(target, { force: true });
  }
});

test("REAL (confined): read-only mode refuses even an in-workspace write", { skip: !confined }, async () => {
  const inside = join(projectRoot, `.beecork-ro-probe-${process.pid}`);
  rmSync(inside, { force: true });
  try {
    const { code } = await runConfined(`echo nope > ${JSON.stringify(inside)}`, "readonly");
    assert.notEqual(code, 0, "read-only mode is a capability floor — the kernel enforces it too");
    assert.equal(existsSync(inside), false);
  } finally {
    rmSync(inside, { force: true });
  }
});

test("REAL (confined): an ordinary read-only command still works inside the sandbox", { skip: !confined }, async () => {
  const { code, stderr } = await runConfined("ls / >/dev/null && echo fine", "normal");
  assert.equal(code, 0, `the sandbox must not break normal commands (stderr: ${stderr})`);
});

// --- usability vs. protection ----------------------------------------------------------------
// A sandbox that breaks `npm install` is a sandbox users turn off, and BEECORK_SANDBOX=off protects
// nobody. So build caches under $HOME are writable — and the things actually worth protecting are
// re-denied AFTER them, so widening the cache list can never quietly widen the credential surface.

test("profile grants build caches but re-denies credentials LAST", () => {
  const p = seatbeltProfile("normal");
  const denyIdx = p.lastIndexOf("(deny file-write*");
  const allowIdx = p.lastIndexOf("(allow file-write*");
  assert.ok(denyIdx > allowIdx, "the deny must come after the allows — Seatbelt is last-match-wins");
  for (const secret of protectedPaths()) assert.ok(p.includes(`(subpath "${secret}")`), `${secret} must be re-denied`);
  assert.ok(protectedPaths().some((s) => s.endsWith(".beecork")), "~/.beecork holds project-approvals.json");
});

test("REAL (confined): build-tool caches are writable, so ordinary installs still work", { skip: !confined }, async () => {
  // Only probe caches that EXIST here. bubblewrap's --bind-try deliberately skips a missing path, so
  // on a fresh machine (a CI runner with no ~/.cargo) an unconditional probe would assert that the
  // sandbox grants access to a directory it was correctly never asked to bind. Seatbelt's subpath
  // rule has no such requirement, which is why this only ever showed up on Linux.
  const present = [".npm/_cacache", ".cache", ".cargo"].filter((d) => existsSync(join(homedir(), d)));
  assert.ok(present.length > 0, "no build cache exists to probe — this test would prove nothing");
  for (const dir of present) {
    const probe = join(homedir(), dir, `beecork-test-${process.pid}`);
    const { code } = await runConfined(`mkdir -p ${JSON.stringify(probe)} && rmdir ${JSON.stringify(probe)}`, "normal");
    assert.equal(code, 0, `~/${dir} must be writable or npm/pip/cargo break inside the sandbox`);
  }
});

test("REAL (confined): credentials and beecork's own approval store stay unwritable", { skip: !confined }, async () => {
  for (const secret of [".ssh", ".aws", ".gnupg", ".beecork"]) {
    const probe = join(homedir(), secret, `beecork-test-${process.pid}`);
    const { code } = await runConfined(`mkdir -p ${JSON.stringify(probe)}`, "normal");
    assert.notEqual(code, 0, `~/${secret} must never be writable from a sandboxed command`);
    assert.equal(existsSync(probe), false);
  }
});

test("REAL (confined): plain $HOME is not writable just because caches inside it are", { skip: !confined }, async () => {
  const probe = join(homedir(), `.beecork-home-probe-${process.pid}`);
  rmSync(probe, { force: true });
  try {
    const { code } = await runConfined(`touch ${JSON.stringify(probe)}`, "normal");
    assert.notEqual(code, 0);
    assert.equal(existsSync(probe), false);
  } finally {
    rmSync(probe, { force: true });
  }
});
