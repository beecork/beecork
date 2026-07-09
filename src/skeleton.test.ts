// Skeleton lifecycle (security- + UX-critical): beecork auto-starts the bundled bridge so the
// user never runs it by hand. These tests spawn the REAL bridge on a throwaway port + temp home
// and exercise: the /health identity marker, the token-gated ingest→signals roundtrip, web-origin
// refusal, single-instance (EADDRINUSE) behavior, and ensureBridge's probe/spawn/idempotency +
// its hands-off rule when the inbox is managed externally. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probe, ensureBridge, skeletonUrl } from "./skeleton";

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "..", "skeleton", "bridge.mjs");
const ENV_KEYS = ["BEECORK_DEV_SIGNALS_URL", "BEECORK_SKELETON_PORT", "BEECORK_SKELETON_HOME"];

// A free localhost port: bind :0, read the assigned port, release it.
function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
  });
}
function snapshotEnv() { return Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])); }
function restoreEnv(prev: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
}

test("probe: 'down' when nothing is listening", async () => {
  const p = await freePort();
  assert.equal(await probe(`http://127.0.0.1:${p}`, 300), "down");
});

test("probe: 'foreign' when a non-skeleton server holds the port", async () => {
  const srv = createServer((_q, r) => r.writeHead(200, { "Content-Type": "application/json" }).end("{}"));
  const p = await freePort();
  await new Promise<void>((r) => srv.listen(p, "127.0.0.1", () => r()));
  try {
    assert.equal(await probe(`http://127.0.0.1:${p}`, 500), "foreign"); // {} has no skeleton:true marker
  } finally { srv.close(); }
});

test("probe: accepts a compatible legacy bridge (serves /signals, lacks /health)", async () => {
  const srv = createServer((q, r) => {
    if (q.url && q.url.startsWith("/signals")) return void r.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ signals: [] }));
    r.writeHead(404).end(); // an older bridge has no /health route
  });
  const p = await freePort();
  await new Promise<void>((r) => srv.listen(p, "127.0.0.1", () => r()));
  try {
    assert.equal(await probe(`http://127.0.0.1:${p}`, 600), "up"); // don't fight a working bridge
  } finally { srv.close(); }
});

test("ensureBridge: hands off (no spawn) when BEECORK_DEV_SIGNALS_URL is set", async () => {
  const prev = snapshotEnv();
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.BEECORK_DEV_SIGNALS_URL = "http://127.0.0.1:59998"; // user/eval-managed inbox
  try {
    const r = await ensureBridge();
    assert.equal(r.reason, "external");
    assert.notEqual(r.started, true); // must NOT have spawned anything
  } finally { restoreEnv(prev); }
});

test("ensureBridge: auto-starts the bundled bridge, is idempotent, and serves token-gated signals", async () => {
  const prev = snapshotEnv();
  for (const k of ENV_KEYS) delete process.env[k];
  const p = await freePort();
  const home = await mkdtemp(join(tmpdir(), "bk-skel-"));
  process.env.BEECORK_SKELETON_PORT = String(p);
  process.env.BEECORK_SKELETON_HOME = home;
  let pid: number | undefined;
  try {
    const r1 = await ensureBridge();
    assert.equal(r1.up, true, "bridge came up");
    assert.equal(r1.started, true, "we started it");
    pid = r1.pid;
    assert.equal(await probe(), "up");

    // Idempotent: a second call reuses the running bridge and does NOT start another.
    const r2 = await ensureBridge();
    assert.equal(r2.up, true);
    assert.notEqual(r2.started, true);

    const url = skeletonUrl();
    const token = (await readFile(join(home, ".beecork-token"), "utf8")).trim();

    // Token-gated ingest → shows up in /signals.
    const ok = await fetch(`${url}/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, kind: "console", text: "boom", ts: Date.now() }) });
    assert.equal(ok.status, 200);
    const sig = (await (await fetch(`${url}/signals`)).json()) as { signals: { text: string }[] };
    assert.equal(sig.signals.length, 1);
    assert.equal(sig.signals[0].text, "boom");

    // Origin scoping: ingest signals from two different sites, then /signals?origin= returns only one.
    for (const u of ["http://localhost:8000/x", "https://app.example.com/y"]) {
      await fetch(`${url}/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, kind: "network", url: u, status: 500, ts: Date.now() }) });
    }
    const scoped = (await (await fetch(`${url}/signals?origin=http://localhost:8000`)).json()) as { signals: { url: string }[] };
    assert.equal(scoped.signals.length, 1, "only the localhost:8000 signal comes back");
    assert.ok(scoped.signals[0].url.startsWith("http://localhost:8000"));

    // Wrong token → rejected.
    const bad = await fetch(`${url}/ingest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: "nope", kind: "console", text: "x" }) });
    assert.equal(bad.status, 401);

    // A web page (carries an http Origin) is refused from reading captured data.
    const web = await fetch(`${url}/signals`, { headers: { Origin: "https://evil.example" } });
    assert.equal(web.status, 403);

    // Single-instance: a second bridge on the same port steps aside (exit 0), never crashes/dupes.
    const second = spawn(process.execPath, [BRIDGE], { env: process.env, stdio: "ignore" });
    const code: number = await new Promise((r) => second.on("exit", (c) => r(c ?? -1)));
    assert.equal(code, 0, "second instance exited quietly on EADDRINUSE");
  } finally {
    if (pid) { try { process.kill(pid); } catch { /* already gone */ } }
    restoreEnv(prev);
  }
});
