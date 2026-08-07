// MCP client tests. The integration cases spawn the REAL fixture server as a real subprocess (same
// approach as skeleton.test.ts) because the bugs worth catching here — chunk-boundary framing, a
// hostile tool name, a timeout leaking a pending entry — only exist at the process boundary.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMcpServers, toolNameFor, flattenContent, childEnv, startMcp, mcpReady, mcpStatus, shutdownMcp, serversFromEnvOverride } from "./mcp";
import { TOOLS, toolsByName, runTool } from "./tools";
import { decideApproval } from "./agent";
import type { ToolCall } from "./types";
import { splitResult } from "./images";

// Tools now return a ToolResult (text, optionally images). These tests assert on the TEXT half.
const runText = async (c: ToolCall, s?: AbortSignal): Promise<string> => splitResult(await runTool(c, s)).text;


const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-echo-server.mjs");

// --- pure ------------------------------------------------------------------

test("parseMcpServers: defaults, coercion, and skipping bad entries", () => {
  const { servers, problems } = parseMcpServers({
    good: { command: "npx", args: ["-y", "x"], env: { A: 1 } },
    minimal: { command: "node" },
    off: { command: "node", enabled: false },
    noCommand: { args: ["x"] },
    notAnObject: "nope",
  });
  assert.deepEqual(servers.map((s) => s.name), ["good", "minimal", "off"]);
  assert.equal(servers[0].env.A, "1", "env values are coerced to strings");
  assert.equal(servers[1].args.length, 0);
  assert.equal(servers[1].enabled, true, "enabled defaults to on");
  assert.equal(servers[2].enabled, false);
  assert.equal(servers[0].trustAnnotations, false, "annotation trust is opt-IN");
  assert.equal(problems.length, 2, "both bad entries reported, neither throws");
});

test("parseMcpServers: a non-object never throws", () => {
  for (const junk of [null, undefined, [], "x", 5]) assert.deepEqual(parseMcpServers(junk).servers, []);
});

test("toolNameFor: namespaces, slugifies, and stays within the 64-char provider limit", () => {
  assert.equal(toolNameFor("playwright", "browser_click"), "mcp__playwright__browser_click");
  assert.equal(toolNameFor("my server", "do.thing"), "mcp__my_server__do_thing");
  const long = toolNameFor("chrome-devtools", "a".repeat(80));
  assert.ok(long.length <= 64, `got ${long.length}`);
  assert.match(long, /^[a-zA-Z0-9_-]{1,64}$/);
  // Two DIFFERENT over-long tools must not collapse onto the same name.
  assert.notEqual(toolNameFor("s", "b".repeat(80) + "one"), toolNameFor("s", "b".repeat(80) + "two"));
});

test("flattenContent: blocks to string, isError to the Error contract", () => {
  assert.equal(flattenContent({ content: [{ type: "text", text: "hi" }] }, "t", 100), "hi");
  // The agent loop + ui.summarizeResult detect failure by the "Error" prefix.
  assert.match(flattenContent({ isError: true, content: [{ type: "text", text: "bad" }] }, "t", 100), /^Error: bad/);
  assert.equal(flattenContent({ isError: true, content: [{ type: "text", text: "Error: bad" }] }, "t", 100), "Error: bad", "no double prefix");
  assert.match(flattenContent({ content: [{ type: "image", mimeType: "image/png" }] }, "t", 100), /image/);
  assert.match(flattenContent({ content: [{ type: "future_type" }] }, "t", 100), /unsupported content block/);
  assert.equal(flattenContent({ content: [] }, "t", 100), "(the tool returned no content)");
  assert.equal(flattenContent({ structuredContent: { a: 1 } }, "t", 100), '{"a":1}');
  assert.match(flattenContent({ content: [{ type: "text", text: "x".repeat(500) }] }, "t", 50), /truncated at 50 chars/);
});

test("childEnv: beecork's own API keys are NOT inherited by a server", () => {
  const prev = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-secret";
  try {
    const env = childEnv({ MINE: "1" });
    assert.equal(env.OPENROUTER_API_KEY, undefined, "the model API key must never leak into a server");
    assert.equal(env.MINE, "1");
  } finally { if (prev === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prev; }
});

// --- integration: a real subprocess ----------------------------------------

test("MCP end-to-end: handshake, registration, framing, failures, and the safety fences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bk-mcp-"));
  const cfgPath = join(dir, "mcp.json");
  // timeoutMs applies to startup AND per request. 3s is generous for spawning node locally while
  // keeping the deliberate "hang" case from sitting on the 60s default.
  await writeFile(cfgPath, JSON.stringify({ mcpServers: { fix: { command: process.execPath, args: [FIXTURE], timeoutMs: 3000 } } }));
  const prev = process.env.BEECORK_MCP_CONFIG;
  process.env.BEECORK_MCP_CONFIG = cfgPath;
  const builtinCount = TOOLS.length;

  try {
    startMcp((await serversFromEnvOverride())!);
    await mcpReady(15_000);

    const conn = mcpStatus()[0];
    assert.equal(conn.status, "ready", conn.error ?? "");
    assert.equal(conn.serverInfo?.name, "fixture");
    assert.equal(conn.protocolVersion, "2025-06-18");
    assert.ok(conn.junkLines >= 1, "non-JSON stdout lines were ignored, not fatal");
    assert.equal(conn.tools.length, 6, "both pages of tools/list were fetched");

    // A server tool must NEVER be able to shadow a built-in.
    assert.ok(conn.rejected.some((r) => r.name === "mcp__fix__run_bash" || r.why.includes("shadow")) === false,
      "the mcp__ prefix means run_bash cannot collide in the first place");
    assert.equal(toolsByName.get("run_bash")!.description.startsWith("[MCP:"), false, "the built-in run_bash is intact");

    // Registered into BOTH structures, and the superset invariant holds.
    assert.ok(conn.registered.includes("mcp__fix__echo"));
    assert.equal(TOOLS.length, builtinCount + conn.registered.length);
    for (const s of TOOLS) assert.ok(toolsByName.has(s.function.name), `${s.function.name} offered to the model but not dispatchable — that is the auth-bypass shape`);

    // Descriptions are tagged and sanitized before reaching the model's context.
    assert.match(toolsByName.get("mcp__fix__echo")!.description, /^\[MCP: fix\] /);
    // $schema is stripped (some providers reject it).
    assert.equal(("$schema" in (toolsByName.get("mcp__fix__echo")!.parameters as any)), false);

    // Permission defaults: dangerous unless the user opted into annotation trust.
    const echo = toolsByName.get("mcp__fix__echo")!;
    assert.equal(echo.needsApproval, true);
    assert.equal(echo.mutates, true, "must be blocked in read-only + plan mode");
    assert.equal(toolsByName.get("mcp__fix__peek")!.mutates, true, "readOnlyHint is IGNORED without trustAnnotations");
    assert.equal(toolsByName.get("mcp__fix__nuke")!.alwaysAsk, true, "destructiveHint is honored (friction-increasing is always safe)");

    // Walk the REAL gate rather than trusting the flags above to mean what we think they mean.
    const ctx = { autoApprove: false, approvedTools: new Set<string>(), approvedGuardKeys: new Set<string>(), toolName: "mcp__fix__echo" };
    assert.equal(decideApproval(echo, {}, { ...ctx, mode: "readonly" }).action, "deny", "read-only mode must block an external tool");
    assert.equal(decideApproval(echo, {}, { ...ctx, mode: "plan" }).action, "deny", "plan mode must block an external tool");
    const normal = decideApproval(echo, {}, { ...ctx, mode: "normal" });
    assert.equal(normal.action, "ask");
    assert.equal(normal.action === "ask" && normal.cacheable, true, "first use asks, and [a]lways can persist it");

    // A real call, whose response is split mid-multi-byte-character across two writes.
    const out = await runText({ id: "1", type: "function", function: { name: "mcp__fix__echo", arguments: '{"text":"hello"}' } });
    assert.equal(out, "echo: hello café ☕", "multi-byte UTF-8 across a chunk boundary survived");

    // isError → the "Error" prefix the agent loop looks for.
    const bad = await runText({ id: "2", type: "function", function: { name: "mcp__fix__boom", arguments: "{}" } });
    assert.match(bad, /^Error: it exploded/);

    // A never-answered call times out, returns a string (never throws), and leaks no pending entry.
    const before = conn.pending.size;
    const hung = await runText({ id: "3", type: "function", function: { name: "mcp__fix__hang", arguments: "{}" } });
    assert.match(hung, /^Error: /);
    assert.equal(conn.pending.size, before, "the timed-out request was removed from the pending map");
  } finally {
    await shutdownMcp();
    if (prev === undefined) delete process.env.BEECORK_MCP_CONFIG; else process.env.BEECORK_MCP_CONFIG = prev;
  }
});

test("a server that dies mid-session tombstones its tools rather than leaving a gap", async () => {
  // On UNEXPECTED death the tools must leave TOOLS (no longer offered) but STAY in toolsByName
  // (still gated, still dispatchable). A name present in TOOLS but missing from toolsByName is the
  // auth-bypass shape: decideApproval's `tool === undefined` fall-through returns {action:"run"}.
  // (A clean shutdown deliberately skips this — the process is going away anyway.)
  const dir = await mkdtemp(join(tmpdir(), "bk-mcp-die-"));
  const cfgPath = join(dir, "mcp.json");
  await writeFile(cfgPath, JSON.stringify({ mcpServers: { doomed: { command: process.execPath, args: [FIXTURE], timeoutMs: 3000 } } }));
  const prev = process.env.BEECORK_MCP_CONFIG;
  process.env.BEECORK_MCP_CONFIG = cfgPath;
  try {
    startMcp((await serversFromEnvOverride())!);
    await mcpReady(15_000);
    const conn = mcpStatus().find((c) => c.cfg.name === "doomed")!;
    assert.equal(conn.status, "ready", conn.error ?? "");
    assert.ok(conn.registered.length > 0);
    const names = [...conn.registered];
    assert.ok(TOOLS.some((s) => s.function.name === names[0]), "offered while alive");

    conn.child!.kill("SIGKILL");
    await new Promise((r) => setTimeout(r, 500)); // let the 'exit' handler run failConnection

    assert.equal(conn.status, "failed");
    for (const n of names) {
      assert.equal(TOOLS.some((s) => s.function.name === n), false, `${n} must stop being offered`);
      const t = toolsByName.get(n);
      assert.ok(t, `${n} must stay dispatchable so the permission gate still sees it`);
      assert.match(splitResult(await t!.run({})).text, /^Error: .*no longer running/, "a tombstoned tool explains itself");
    }
  } finally {
    await shutdownMcp();
    if (prev === undefined) delete process.env.BEECORK_MCP_CONFIG; else process.env.BEECORK_MCP_CONFIG = prev;
  }
});
