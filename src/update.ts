// Non-blocking "a newer version is available" notice. Checks the npm registry at most once a
// day (cached in ~/.beecork), fails SILENTLY (no network / any error → no notice), and only
// NOTIFIES — never auto-installs (self-updating a global npm CLI is fragile: the process often
// can't write its own install, and swapping the binary mid-run is wrong). Opt out: NO_UPDATE_NOTIFIER.

import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once a day
const cacheFile = () => join(homedir(), ".beecork", "update-check.json");

// Our own version, read from the package.json that ships with the install (one dir up from the
// bundle / from src/ in dev). import.meta.url resolves correctly in both the esbuild bundle and tsx.
export async function currentVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    return String(pkg.version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
}

// The directory holding the running install's package.json. For a global npm install that's
// <prefix>/lib/node_modules/beecork (unix) or <prefix>/node_modules/beecork (Windows); in dev
// (`npm run dev`) it's the repo root. import.meta.url resolves in both the bundle and tsx.
function runningPkgRoot(): string {
  return fileURLToPath(new URL("..", import.meta.url));
}

// The npm PREFIX that owns the running install, or null when we're not in a node_modules layout (dev
// or an unrecognized install). `beecork update` passes this to `npm install -g --prefix` so the update
// lands on the copy you're actually running — not whatever prefix npm defaults to when you have
// several Node installs. That mismatch is the usual cause of "I updated but still see the old version".
// Pure derivation (exported for tests): given the install's package root, return the npm prefix, or
// null if the layout isn't a node_modules install (dev). Handles both <prefix>/lib/node_modules/beecork
// (unix) and <prefix>/node_modules/beecork (Windows).
export function prefixFromPkgRoot(pkgRoot: string): string | null {
  const nm = dirname(pkgRoot); // …/node_modules  (or repo/.. in dev)
  if (basename(nm) !== "node_modules") return null;
  const up = dirname(nm); // <prefix>/lib  or  <prefix>
  return basename(up) === "lib" ? dirname(up) : up;
}
export function installPrefix(): string | null {
  return prefixFromPkgRoot(runningPkgRoot());
}

// Other beecork executables on PATH that resolve to a DIFFERENT install than the one running. A stale
// copy earlier in PATH silently shadows a successful update ("I updated but still see the old version"),
// so `beecork update` warns about these. Best-effort + unix-focused: it resolves each bin symlink to
// its package.json and skips anything it can't read.
export async function findShadowingInstalls(): Promise<{ bin: string; version: string }[]> {
  let running: string;
  try { running = await realpath(runningPkgRoot()); } catch { running = runningPkgRoot(); }
  const names = process.platform === "win32" ? ["beecork.cmd", "beecork"] : ["beecork"];
  const seenRoots = new Set<string>([running]);
  const others: { bin: string; version: string }[] = [];
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      try {
        const bin = join(dir, name);
        const root = dirname(dirname(await realpath(bin))); // …/beecork/dist/index.js → …/beecork
        if (seenRoots.has(root)) continue;
        seenRoots.add(root);
        const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
        if (String(pkg.name) === "beecork") others.push({ bin, version: String(pkg.version ?? "?").replace(/[^\w.+-]/g, "") });
      } catch { /* no resolvable beecork here — skip */ }
    }
  }
  return others;
}

// A ready-to-print warning if another beecork on PATH will shadow the one just updated, else null.
export async function shadowWarning(): Promise<string | null> {
  const others = await findShadowingInstalls();
  if (!others.length) return null;
  return (
    "⚠ Another beecork is on your PATH and may shadow the version you just installed:\n" +
    others.map((o) => `    ${o.bin}  (v${o.version})`).join("\n") +
    "\n  Remove the stale one(s) so `beecork` always runs the newest install (may need sudo):\n" +
    others.map((o) => `    rm ${o.bin}`).join("\n")
  );
}

// a > b for simple x.y.z versions (prerelease tags ignored — fine for our scheme). Exported for tests.
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/beecork/latest", {
      headers: { Accept: "application/vnd.npm.install-v1+json" }, // the slim metadata doc
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: string })?.version;
    // Only accept a clean semver-shaped string. This both rejects garbage and guarantees the
    // value (later printed to the terminal) carries no control/escape bytes — a registry
    // response can't smuggle a cursor-move/OSC spoof through the "update available" notice.
    return typeof v === "string" && /^\d+\.\d+\.\d+[\w.+-]*$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

// Returns the newer version to advertise (from the LAST cached check), or null. When the cache is
// stale it refreshes in the BACKGROUND for next time — so startup never blocks on the network
// (standard update-notifier behavior: the notice you see is from the previous run's check).
export async function checkForUpdate(current: string): Promise<string | null> {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI) return null;
  let cache: { checkedAt?: number; latest?: string } = {};
  try {
    cache = JSON.parse(await readFile(cacheFile(), "utf8"));
  } catch {
    // no cache yet — first run just kicks off a background check
  }
  if (!cache.checkedAt || Date.now() - cache.checkedAt > CHECK_INTERVAL_MS) {
    void fetchLatest().then(async (latest) => {
      if (!latest) return;
      try {
        const file = cacheFile();
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify({ checkedAt: Date.now(), latest }), "utf8");
      } catch {
        // best-effort
      }
    });
  }
  return cache.latest && isNewer(cache.latest, current) ? cache.latest : null;
}

// Run `npm install -g beecork@latest` for the user (the `beecork update` command + the /update
// slash command). User-initiated, so running the install on their behalf is fine; if it fails
// (a sudo / version-manager permission setup), we hand back the output so they can run it manually.
// A timeout kills a hung install so /update can't freeze the REPL indefinitely.
export function selfUpdate(timeoutMs = 120_000): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    // Windows resolves the binary as `npm.cmd`; a bare "npm" spawn (no shell) ENOENTs there.
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    // Target the running install's prefix when we can derive it, so the update lands on the copy you're
    // actually running (not npm's default prefix). Falls back to a plain global install otherwise.
    const prefix = installPrefix();
    const args = ["install", "-g", "beecork@latest", ...(prefix ? ["--prefix", prefix] : [])];
    const child = spawn(npm, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", done = false;
    const finish = (r: { ok: boolean; output: string }) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ ok: false, output: `${out.trim()}\n(update timed out after ${timeoutMs}ms — run manually: npm install -g beecork@latest)`.trim() });
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => (out += d));
    child.stderr?.on("data", (d: Buffer) => (out += d));
    child.on("error", (e) => finish({ ok: false, output: e.message }));
    child.on("close", (code) => finish({ ok: code === 0, output: out.trim() }));
  });
}
