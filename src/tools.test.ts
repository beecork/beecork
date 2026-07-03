// Regression tests for the file-mutation invariants: schema validation (no empty-content clobber),
// edit_file's exactly-once match + literal-$ replacer, and atomicWrite preserving the file mode.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { runTool } from "./tools";
import { projectRoot } from "./paths";
import type { ToolCall } from "./types";

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
