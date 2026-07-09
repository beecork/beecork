// Beecork Skeleton — local inbox (bridge). SHIPPED WITH beecork and auto-started
// by it (src/skeleton.ts), so the user never runs this by hand. It can still be run
// directly (`node skeleton/bridge.mjs`) for development.
//
// Receives signals POSTed by the extension, keeps a *bounded* rolling window of the
// most recent ones, and mirrors that window to dev-signals.jsonl (one JSON object per
// line). Writes are atomic (temp file + rename) so a reader never sees a half file.
// No dependencies — Node built-ins only.
//
// Lifecycle notes (what makes it safe for beecork to own):
//   - Single instance: a second copy racing for the port exits(0) quietly on EADDRINUSE
//     instead of crashing — so parallel beecork sessions share ONE inbox.
//   - Self-tidying: exits itself after IDLE_MS with no traffic and no reads, so an
//     auto-started bridge can't linger forever after the extension/browser is gone.
//   - Fixed home: reads/writes under BEECORK_SKELETON_HOME (beecork points this at
//     ~/.beecork/skeleton) instead of whatever cwd it was launched from.

import http from "node:http";
import { writeFile, readFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.BEECORK_SKELETON_PORT) || 8317;
const HOME = process.env.BEECORK_SKELETON_HOME || process.cwd();
const FILE = resolve(HOME, "dev-signals.jsonl");
const TMP = FILE + ".tmp";
const TOKEN_FILE = resolve(HOME, ".beecork-token");
const MAX = 1000; // keep at most this many recent signals
const IDLE_MS = 60 * 60 * 1000; // self-shutdown after an hour with zero activity

// Pairing token: the extension must present this to write. Blocks any other local
// process or malicious web page from POSTing fake signals to your agent. Generated
// once and persisted; the extension fetches it via /pair so the user never sees it.
let TOKEN;
try {
  TOKEN = (await readFile(TOKEN_FILE, "utf8")).trim();
  if (!TOKEN) throw new Error("empty token file");
} catch {
  TOKEN = randomBytes(24).toString("hex");
  await writeFile(TOKEN_FILE, TOKEN + "\n", { mode: 0o600 });
}

let buffer = []; // rolling in-memory window of recent signal lines; the file mirrors it.
const watchRequests = new Map(); // origin beecork asked to watch → expiry (ms)
let lastActivity = Date.now(); // reset on every request; drives idle self-shutdown

// Load any existing signals so a bridge restart keeps recent context.
try {
  const prior = await readFile(FILE, "utf8");
  buffer = prior.split("\n").filter(Boolean).slice(-MAX);
} catch {
  /* no file yet — start empty */
}

// Persist the bounded window atomically. Writes are serialized through one chain so
// two concurrent ingests can't clobber the temp file mid-write.
let chain = Promise.resolve();
function persist() {
  chain = chain
    .then(async () => {
      await writeFile(TMP, buffer.length ? buffer.join("\n") + "\n" : "");
      await rename(TMP, FILE);
    })
    .catch((e) => console.error("[skeleton] persist failed:", e));
  return chain;
}

// A web page's fetch carries an http(s) Origin; refuse those so a page you visit can't
// read your captured app data or drive your extension. beecork's Node fetch has no web
// origin and passes. No CORS header is set on these routes on purpose.
const fromWebPage = (req) => /^https?:\/\//i.test(req.headers.origin || "");

const server = http.createServer((req, res) => {
  lastActivity = Date.now();

  // Liveness + identity marker: lets beecork tell OUR bridge apart from some other
  // program that happens to hold the port, so it never spawns a duplicate or talks to
  // a stranger. Non-sensitive, but web-origin-gated like everything else.
  if (req.method === "GET" && req.url === "/health") {
    if (fromWebPage(req)) return void res.writeHead(403).end("forbidden");
    return void res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ skeleton: true, port: PORT, signals: buffer.length }));
  }

  // Auto-pairing: hand the token to the extension so the user never touches it.
  if (req.method === "GET" && req.url === "/pair") {
    if (fromWebPage(req)) return void res.writeHead(403).end("forbidden");
    return void res.writeHead(200, { "Content-Type": "text/plain" }).end(TOKEN);
  }

  // A distilled read for the agent: recent signals, filtered. ?kind=&since=<epoch-ms>&limit=
  if (req.method === "GET" && req.url.startsWith("/signals")) {
    if (fromWebPage(req)) return void res.writeHead(403).end("forbidden");
    const q = new URL(req.url, "http://localhost").searchParams;
    const kind = q.get("kind");
    const since = Number(q.get("since")) || 0;
    const limit = Math.min(Math.max(Number(q.get("limit")) || 50, 1), 1000);
    // Scope to one or more origins (comma-separated) so a project sees only its own site's signals.
    const origins = (q.get("origin") || "").split(",").map((s) => s.trim()).filter(Boolean);
    let items = buffer.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (kind && kind !== "all") items = items.filter((s) => s.kind === kind);
    if (since) items = items.filter((s) => (s.ts || 0) >= since);
    if (origins.length) items = items.filter((s) => origins.some((o) => String(s.url || "").startsWith(o)));
    items = items.slice(-limit);
    return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ signals: items }));
  }

  // Reverse channel: beecork asks for a site to be watched. The extension honors it
  // only for sites the user already approved.
  if (req.method === "POST" && req.url === "/request-watch") {
    if (fromWebPage(req)) return void res.writeHead(403).end("forbidden");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { origin: site, ttlMs } = JSON.parse(body || "{}");
        if (site) watchRequests.set(String(site), Date.now() + (Number(ttlMs) || 10 * 60 * 1000));
        res.writeHead(200).end("ok");
      } catch {
        res.writeHead(400).end("bad json");
      }
    });
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/watch-requests")) {
    if (fromWebPage(req)) return void res.writeHead(403).end("forbidden");
    const now = Date.now();
    for (const [site, exp] of watchRequests) if (exp < now) watchRequests.delete(site); // expire
    return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ origins: [...watchRequests.keys()] }));
  }

  // Permissive CORS so the extension's service worker can POST to /ingest.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();

  if (req.method === "POST" && req.url === "/ingest") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const signal = JSON.parse(body);
        if (signal.token !== TOKEN) { res.writeHead(401).end("unauthorized"); return; } // token-gated
        delete signal.token; // never persist the token itself
        buffer.push(JSON.stringify(signal));
        if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX); // bound it
        await persist();
        console.log(`[skeleton] ${signal.kind}: ${String(signal.text || "").slice(0, 200)}`);
        res.writeHead(200).end("ok");
      } catch {
        res.writeHead(400).end("bad json");
      }
    });
    return;
  }
  res.writeHead(404).end();
});

// Single-instance: if another bridge already holds the port (a parallel beecork
// session started it), step aside quietly rather than crash.
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") process.exit(0);
  console.error("[skeleton]", e);
  process.exit(1);
});

// Self-tidying: an auto-started bridge shouldn't outlive its usefulness. When the
// extension is loaded it polls every ~30s, so this only fires once the browser side
// is truly gone AND nothing has read for an hour.
const idle = setInterval(() => {
  if (Date.now() - lastActivity > IDLE_MS) { server.close(); process.exit(0); }
}, 5 * 60 * 1000);
idle.unref(); // don't let the timer alone keep the process alive

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[skeleton] inbox listening on http://localhost:${PORT} (home: ${HOME})`);
});
