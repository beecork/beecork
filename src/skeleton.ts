// Beecork Skeleton lifecycle — beecork OWNS the local inbox (bridge) so the user never
// starts it by hand. `ensureBridge()` is called lazily by the browser tools (read_dev_signals
// / watch_site) right before they read: it checks whether our bridge is already listening and,
// if not, spawns the bundled skeleton/bridge.mjs DETACHED so it outlives this session and every
// parallel session shares one inbox. Best-effort — if the spawn fails, the tools fall back to
// the same "here's how to connect" guidance as before, so nothing regresses.

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

// Read at call time (not module load) so env overrides — and tests — take effect.
const port = (): number => Number(process.env.BEECORK_SKELETON_PORT) || 8317;

// The inbox URL the tools read from. An explicit BEECORK_DEV_SIGNALS_URL wins (a user
// pointing at their own bridge, or an eval pointing at a dead port) — and in that case
// beecork does NOT auto-spawn, because the user is managing the inbox themselves.
export const skeletonUrl = (): string => process.env.BEECORK_DEV_SIGNALS_URL || `http://localhost:${port()}`;
const managedExternally = (): boolean => !!process.env.BEECORK_DEV_SIGNALS_URL;

const skeletonHome = (): string => process.env.BEECORK_SKELETON_HOME || join(homedir(), ".beecork", "skeleton");
const bridgeScript = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "skeleton", "bridge.mjs");

export type Liveness = "up" | "down" | "foreign"; // ours | nothing there | something else holds the port

// Is a usable inbox answering on `url`? "foreign" means the port is held by something that
// isn't a skeleton bridge (so we must NOT spawn a duplicate, and must warn the user).
export async function probe(url = skeletonUrl(), timeoutMs = 600): Promise<Liveness> {
  // 1) Our bridge announces itself at /health.
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const j = (await res.json()) as { skeleton?: boolean };
      if (j && j.skeleton === true) return "up";
    }
  } catch {
    return "down"; // connection refused / timeout → nothing is listening
  }
  // 2) Something is listening but isn't our /health. Accept a COMPATIBLE older bridge that still
  //    serves the signals API (so a manually-started legacy bridge isn't fought over); anything
  //    else is a stranger holding the port.
  try {
    const res = await fetch(`${url}/signals?limit=1`, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const j = (await res.json()) as { signals?: unknown };
      if (Array.isArray(j && j.signals)) return "up";
    }
  } catch { /* fall through to foreign */ }
  return "foreign";
}

export type EnsureResult = { up: boolean; started?: boolean; pid?: number; reason?: "external" | "foreign-port" | "spawn-failed" };

let inFlight: Promise<EnsureResult> | null = null; // dedupe concurrent tool calls in one session

// Ensure the inbox is running (idempotent). Returns quickly if it's already up or if the
// user manages it. Spawns the bundled bridge detached when nothing is listening.
export function ensureBridge(): Promise<EnsureResult> {
  if (inFlight) return inFlight;
  inFlight = doEnsure().finally(() => { inFlight = null; });
  return inFlight;
}

async function doEnsure(): Promise<EnsureResult> {
  if (managedExternally()) return { up: false, reason: "external" }; // hands off — don't spawn

  const first = await probe();
  if (first === "up") return { up: true };
  if (first === "foreign") return { up: false, reason: "foreign-port" };

  // Nothing listening → start our bridge, detached, from a fixed home.
  let pid: number | undefined;
  try {
    const home = skeletonHome();
    await mkdir(home, { recursive: true });
    const child = spawn(process.execPath, [bridgeScript()], {
      cwd: home,
      env: { ...process.env, BEECORK_SKELETON_HOME: home, BEECORK_SKELETON_PORT: String(port()) },
      detached: true,
      stdio: "ignore", // fire-and-forget; it logs to no one, which is fine
    });
    child.on("error", () => {}); // e.g. node missing — swallow; we degrade below
    pid = child.pid;
    child.unref(); // never keep beecork alive on its account
  } catch {
    return { up: false, reason: "spawn-failed" };
  }

  // Poll until it binds (or give up ~2s in — then the tool falls back to setup guidance).
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if ((await probe()) === "up") return { up: true, started: true, pid };
  }
  return { up: false, started: true, pid, reason: "spawn-failed" };
}
