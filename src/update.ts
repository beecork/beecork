// Non-blocking "a newer version is available" notice. Checks the npm registry at most once a
// day (cached in ~/.beecork), fails SILENTLY (no network / any error → no notice), and only
// NOTIFIES — never auto-installs (self-updating a global npm CLI is fragile: the process often
// can't write its own install, and swapping the binary mid-run is wrong). Opt out: NO_UPDATE_NOTIFIER.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
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

// a > b for simple x.y.z versions (prerelease tags ignored — fine for our scheme).
function isNewer(a: string, b: string): boolean {
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
    return typeof v === "string" ? v : null;
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
export function selfUpdate(): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["install", "-g", "beecork@latest"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d));
    child.stderr?.on("data", (d: Buffer) => (out += d));
    child.on("error", (e) => resolve({ ok: false, output: e.message }));
    child.on("close", (code) => resolve({ ok: code === 0, output: out.trim() }));
  });
}
