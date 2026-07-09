// Regression tests for the file-mutation invariants: schema validation (no empty-content clobber),
// edit_file's exactly-once match + literal-$ replacer, and atomicWrite preserving the file mode.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTool, resolveEdit } from "./tools";
import { projectRoot } from "./paths";
import type { ToolCall } from "./types";

// Apply a successful resolution the same way edit_file's run() does (offset slice-and-splice).
const applyEdit = (file: string, r: ReturnType<typeof resolveEdit>): string =>
  r.ok ? file.slice(0, r.start) + r.after + file.slice(r.end) : "";

const dir = join(projectRoot, ".tools-test");
const rel = ".tools-test";
const call = (name: string, args: object): ToolCall => ({ id: "t1", type: "function", function: { name, arguments: JSON.stringify(args) } });

test("write_file with no content is rejected (no empty clobber)", async () => {
  const res = await runTool(call("write_file", { path: `${rel}/x.txt` }));
  assert.match(res, /^Error/);
  assert.match(res, /content/);
});

test("edit_file: exactly-once match, literal-$ replacer, mode preserved", async (t) => {
  mkdirSync(dir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Ambiguous match → refused.
  const dupPath = join(dir, "dup.txt");
  writeFileSync(dupPath, "foo\nfoo\n");
  const dupRes = await runTool(call("edit_file", { path: `${rel}/dup.txt`, old_text: "foo", new_text: "bar" }));
  assert.match(dupRes, /appears 2 times|exactly once|more surrounding/i);
  assert.equal(readFileSync(dupPath, "utf8"), "foo\nfoo\n"); // unchanged

  // Literal replacement: $&, $`, $1 must be inserted verbatim, not regex-expanded.
  const litPath = join(dir, "lit.txt");
  writeFileSync(litPath, "REPLACE_ME here");
  const litNew = "a$&b$`c$1d";
  const litRes = await runTool(call("edit_file", { path: `${rel}/lit.txt`, old_text: "REPLACE_ME", new_text: litNew }));
  assert.match(litRes, /Edited/);
  assert.equal(readFileSync(litPath, "utf8"), `${litNew} here`);

  // Mode preservation: atomicWrite keeps the original file mode (e.g. +x).
  const exePath = join(dir, "run.sh");
  writeFileSync(exePath, "old\n");
  chmodSync(exePath, 0o755);
  await runTool(call("edit_file", { path: `${rel}/run.sh`, old_text: "old", new_text: "new" }));
  assert.equal(readFileSync(exePath, "utf8"), "new\n");
  assert.equal(statSync(exePath).mode & 0o777, 0o755, "executable bit preserved after edit");
});

// --- edit_file self-healing (resolveEdit) ------------------------------------

test("resolveEdit: exact match, ambiguous refusal, genuine not-found", () => {
  const file = "line one\nline two\nline three\n";
  const ex = resolveEdit(file, "line two", "LINE TWO");
  assert.ok(ex.ok && ex.healedVia === "exact");
  assert.equal(applyEdit(file, ex), "line one\nLINE TWO\nline three\n");

  assert.deepEqual(resolveEdit("foo\nfoo\n", "foo", "bar"), { ok: false, reason: "ambiguous", count: 2 });

  const nf = resolveEdit(file, "totally absent text", "x");
  assert.ok(!nf.ok && nf.reason === "not_found");
});

test("resolveEdit heals a pasted read_file line-number prefix (old AND new)", () => {
  const file = "const a = 1;\nconst b = 2;\n";
  const r = resolveEdit(file, "    2  const b = 2;", "    2  const b = 20;"); // padStart(5) num + 2 spaces
  assert.ok(r.ok && r.healedVia === "prefix");
  assert.equal(applyEdit(file, r), "const a = 1;\nconst b = 20;\n");
});

test("resolveEdit heals a uniform indentation shift and reindents new_text to match", () => {
  // A MULTI-LINE block the model under-indented — not a substring (file has "\n    b" between lines),
  // so the exact tier misses and the whitespace tier must reindent new_text to the file's 4 spaces.
  const file = "class C {\n    a();\n    b();\n}\n";
  const r = resolveEdit(file, "a();\nb();", "a();\nc();");
  assert.ok(r.ok && r.healedVia === "whitespace");
  assert.equal(applyEdit(file, r), "class C {\n    a();\n    c();\n}\n");
});

test("resolveEdit refuses a NON-uniform whitespace drift (never guesses)", () => {
  const file = "  a\n      b\n"; // line1 indented 2, line2 indented 6
  const r = resolveEdit(file, "a\n  b", "x"); // model used shifts of 0 and 2 → non-uniform
  assert.ok(!r.ok, "must not auto-heal a non-uniform indentation change");
});

test("resolveEdit not-found hands back the closest real line as feedback", () => {
  const file = "  alpha();\n  beta();\n";
  const r = resolveEdit(file, "alpha();\nGAMMA();", "x"); // first line matches a real line, second doesn't
  assert.ok(!r.ok && r.reason === "not_found");
  assert.match(String(r.closest), /alpha\(\);/);
});

test("resolveEdit not-found feedback finds a NEAR-miss line by word overlap (typo)", () => {
  const file = "export function greet(name: string) {\n  return `hi ${name}`;\n}\n";
  const r = resolveEdit(file, "return `hi ${nom}`;", "x"); // 'nom' typo for 'name' — no exact line match
  assert.ok(!r.ok && r.reason === "not_found");
  assert.match(String(r.closest), /return `hi \$\{name\}`;/); // still points at the real line
});

test("edit_file: heals indentation drift end-to-end and reports the heal", async (t) => {
  const hdir = join(projectRoot, ".tools-heal-test");
  const hrel = ".tools-heal-test";
  mkdirSync(hdir, { recursive: true });
  t.after(() => rmSync(hdir, { recursive: true, force: true }));
  const p = join(hdir, "code.ts");
  writeFileSync(p, "export function f() {\n  return 1;\n}\n"); // 2-space indent
  // model OVER-indents old_text (4 spaces) → not a substring → whitespace tier strips the extra indent
  const res = await runTool(call("edit_file", { path: `${hrel}/code.ts`, old_text: "    return 1;", new_text: "    return 2;" }));
  assert.match(res, /Edited/);
  assert.match(res, /auto-healed/);
  assert.equal(readFileSync(p, "utf8"), "export function f() {\n  return 2;\n}\n");
});

test("ask_user run(): headless proceed message + validation", async () => {
  // Non-interactive (test env) → run() tells the model to proceed with a default.
  const ok = await runTool(call("ask_user", { question: "npm or pnpm?", options: [{ label: "npm" }, { label: "pnpm" }] }));
  assert.match(ok, /headless|proceed/i);
  // Missing options → an Error the model can react to.
  const bad = await runTool(call("ask_user", { question: "which?", options: [] }));
  assert.match(bad, /^Error/);
});
