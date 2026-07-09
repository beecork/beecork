// Regression tests for the file-mutation invariants: schema validation (no empty-content clobber),
// edit_file's exactly-once match + literal-$ replacer, and atomicWrite preserving the file mode.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { runTool, resolveEdit, toolDefs } from "./tools";
import { projectRoot } from "./paths";
import { loadProjectOrigins } from "./projectSites";
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

const devSignals = () => toolDefs.find((t) => t.name === "read_dev_signals")!;

test("read_dev_signals: relays setup steps when no bridge is reachable", async () => {
  const prev = process.env.BEECORK_DEV_SIGNALS_URL;
  process.env.BEECORK_DEV_SIGNALS_URL = "http://127.0.0.1:59237"; // nothing listening → ECONNREFUSED
  try {
    const out = await devSignals().run({});
    assert.match(out, /Beecork Skeleton/);
    assert.match(out, /Pair this site/);
    assert.doesNotMatch(out, /^Error/); // it's guidance to relay, not a tool failure
  } finally {
    if (prev === undefined) delete process.env.BEECORK_DEV_SIGNALS_URL;
    else process.env.BEECORK_DEV_SIGNALS_URL = prev;
  }
});

test("read_dev_signals: formats connected signals and drops meta 'watch' lines", async () => {
  const now = Date.now();
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        signals: [
          { kind: "watch", text: "watching tab 1", ts: now },
          { kind: "network", method: "GET", url: "https://app/api/x", status: 500, ts: now - 2000 },
          { kind: "console", text: "boom", url: "https://app/", ts: now - 1000 },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const prev = process.env.BEECORK_DEV_SIGNALS_URL;
  process.env.BEECORK_DEV_SIGNALS_URL = `http://127.0.0.1:${port}`;
  try {
    const out = await devSignals().run({});
    assert.match(out, /2 browser signal/); // the "watch" line is dropped → 2, not 3
    assert.match(out, /\[network\] GET https:\/\/app\/api\/x → 500/);
    assert.match(out, /\[console\] boom/);
    assert.doesNotMatch(out, /watching tab/);
  } finally {
    server.close();
    if (prev === undefined) delete process.env.BEECORK_DEV_SIGNALS_URL;
    else process.env.BEECORK_DEV_SIGNALS_URL = prev;
  }
});

const watchSite = () => toolDefs.find((t) => t.name === "watch_site")!;

test("watch_site: rejects an invalid URL and relays setup when no bridge is reachable", async () => {
  assert.match(await watchSite().run({ url: "not a url" }), /^Error/); // no request made
  const prev = process.env.BEECORK_DEV_SIGNALS_URL;
  process.env.BEECORK_DEV_SIGNALS_URL = "http://127.0.0.1:59237";
  try {
    assert.match(await watchSite().run({ url: "https://app.example.com" }), /Beecork Skeleton/);
  } finally {
    if (prev === undefined) delete process.env.BEECORK_DEV_SIGNALS_URL;
    else process.env.BEECORK_DEV_SIGNALS_URL = prev;
  }
});

test("watch_site: POSTs origin (path stripped) + ttl when connected", async () => {
  let received: { origin?: string; ttlMs?: number } = {};
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received = JSON.parse(body || "{}");
      res.writeHead(200).end("ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const prev = process.env.BEECORK_DEV_SIGNALS_URL;
  process.env.BEECORK_DEV_SIGNALS_URL = `http://127.0.0.1:${port}`;
  const savedCwd = process.cwd();
  const proj = mkdtempSync(join(tmpdir(), "bk-watch-")); // isolate cwd: watch_site writes .beecork/skeleton.json
  try {
    process.chdir(proj);
    const out = await watchSite().run({ url: "https://app.example.com/checkout?x=1", minutes: 5 });
    assert.match(out, /Requested watching https:\/\/app\.example\.com/);
    assert.equal(received.origin, "https://app.example.com"); // origin only — path/query stripped
    assert.equal(received.ttlMs, 5 * 60000);
    // It remembers this site for the project, so later read_dev_signals here auto-scopes to it.
    assert.deepEqual(await loadProjectOrigins(), ["https://app.example.com"]);
    assert.match(out, /remember https:\/\/app\.example\.com as this project's site/);
  } finally {
    process.chdir(savedCwd);
    server.close();
    if (prev === undefined) delete process.env.BEECORK_DEV_SIGNALS_URL;
    else process.env.BEECORK_DEV_SIGNALS_URL = prev;
  }
});
