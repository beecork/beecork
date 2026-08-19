// OS-LEVEL CONFINEMENT for the commands beecork runs.
//
// beecork already has a lot of policy: a catastrophic-command denylist, a safe-command classifier,
// secret-file gates, path containment, and an approval prompt. Those answer "SHOULD this be
// attempted?" and they are worth keeping. They cannot answer "what is this process CAPABLE of?" —
// an approved command can follow a symlink out of the tree, exec an interpreter that does something
// else entirely, assemble a path at runtime, or spawn a child none of the parsing ever saw.
//
// This file adds the second answer. It wraps the two spawn sites that run MODEL-CHOSEN commands
// (run_bash in tools.ts, background tasks in tasks.ts) in a kernel-enforced filesystem boundary.
// beecork's own fixed subprocesses — git for the status line, the editor opener, the skeleton
// bridge, MCP servers the USER configured — are not model-chosen and are deliberately left alone.
//
// Shape of the profile, on every platform: reads stay broad (a coding agent has to read its
// toolchain), WRITES are confined to the workspace plus the temp directory. Write confinement is
// what actually protects the user; a read jail would break compilers, package managers and language
// runtimes for very little gain.

import { execFile } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { projectRoot } from "./paths";
import { config } from "./config";
import type { Mode } from "./state";

// What a caller should actually hand to spawn(). `shell:true` disappears once we wrap: the sandbox
// runner becomes argv[0] and the user's command is passed to an explicit shell inside it.
export type SpawnSpec = { cmd: string; args: string[]; shell: boolean };

export type SandboxStatus =
  | { kind: "active"; runner: "seatbelt" | "bubblewrap" }
  | { kind: "off"; reason: string } // deliberately disabled
  | { kind: "unavailable"; reason: string }; // wanted, but no working runner here

let probed: SandboxStatus | null = null;
let warned = false;

const canonical = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// Seatbelt string literals are double-quoted; a path containing a quote or backslash would otherwise
// end the literal early and change the meaning of the profile.
const sbQuote = (p: string): string => `"${p.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Build-tool caches. These live in $HOME, which is otherwise denied — and without them `npm install`,
// `pip install` and `cargo build` all fail inside the sandbox with a bare "Operation not permitted".
// That matters more than it looks: a sandbox that breaks ordinary work is a sandbox users switch off,
// and BEECORK_SANDBOX=off protects nobody. These are caches, not credentials; the deny list below
// keeps the things worth protecting out of reach regardless.
const CACHE_DIRS = [
  ".npm", ".yarn", ".pnpm-store", ".bun", ".deno", ".node-gyp", ".nvm",
  ".cache", ".cargo", ".rustup", ".gradle", ".m2", ".ivy2", ".sbt",
  ".gem", ".bundle", ".composer", ".nuget", ".dotnet", ".pub-cache",
  ".pyenv", ".rbenv", ".local/share/virtualenvs", ".cocoapods", "go/pkg",
  "Library/Caches", "Library/pnpm", "Library/Developer/Xcode/DerivedData",
];

// Never writable, even if one of the roots above happens to contain it. Seatbelt is last-match-wins,
// so emitting these AFTER the allows makes the guarantee structural rather than a matter of ordering
// luck. ~/.beecork is on this list for a specific reason: it holds project-approvals.json, so a
// command that could write there could grant ITSELF permissions for the next turn.
const NEVER_WRITABLE = [".ssh", ".gnupg", ".aws", ".kube", ".docker", ".netrc", ".beecork", ".config/gh", ".git-credentials"];

const homeSubpaths = (names: string[]): string[] => names.map((n) => join(homedir(), n));

// Extra roots the USER opts into (colon- or comma-separated), for a toolchain we don't know about.
// Deliberately env-only, like every other beecork knob: a checked-in file must never be able to
// widen the sandbox of whoever clones the repo.
const extraRoots = (): string[] =>
  (process.env.BEECORK_SANDBOX_WRITABLE ?? "")
    .split(/[:,]/)
    .map((r) => r.trim())
    .filter(Boolean);

// Directories the command may WRITE to. Everything else on the filesystem is read-only.
function writableRoots(): string[] {
  const roots = [projectRoot, canonical(tmpdir()), "/tmp", ...homeSubpaths(CACHE_DIRS), ...extraRoots()];
  // macOS hands out per-user temp under /var/folders (symlinked from /private/var/folders); many
  // toolchains write there via TMPDIR, so include both spellings rather than half of one.
  if (process.platform === "darwin") roots.push("/private/tmp", "/private/var/folders", "/var/folders");
  return [...new Set(roots.map(canonical))];
}

/** Paths that stay read-only no matter what the allow list says. */
export const protectedPaths = (): string[] => homeSubpaths(NEVER_WRITABLE);

/**
 * A macOS Seatbelt profile.
 *
 * It starts from `(allow default)` and subtracts writes, rather than starting from `(deny default)`
 * and adding back. A deny-by-default profile has to re-permit dyld, /dev, sysctl, mach lookups and
 * more before anything runs at all — every omission is a broken build command, and the failures are
 * cryptic. Since the goal here is filesystem WRITE confinement, subtracting exactly that is both
 * easier to verify by reading and far less likely to break a legitimate toolchain.
 * Later rules win, so the targeted allows below re-open the specific roots.
 */
export function seatbeltProfile(mode: Mode): string {
  const lines = ["(version 1)", "(allow default)", "(deny file-write*)"];

  // Always writable: the process's own plumbing. Without these even `echo hi` fails.
  const devices = ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty", "/dev/stdout", "/dev/stderr"];
  lines.push(`(allow file-write* ${devices.map((d) => `(literal ${sbQuote(d)})`).join(" ")} (subpath ${sbQuote("/dev/fd")}))`);

  // read-only and plan mode are CAPABILITY modes: nothing that mutates may run at all. The approval
  // gate already refuses those tools, so this is defence in depth for whatever slips past it.
  if (mode !== "readonly" && mode !== "plan") {
    lines.push(`(allow file-write* ${writableRoots().map((r) => `(subpath ${sbQuote(r)})`).join(" ")})`);
  }
  // LAST, so it wins: credentials and beecork's own approval store are never writable, even if a
  // cache root above happens to contain one of them.
  lines.push(`(deny file-write* ${protectedPaths().map((p) => `(subpath ${sbQuote(p)})`).join(" ")})`);
  return lines.join("\n");
}

/** bubblewrap argv: everything read-only, the writable roots bound back in rw. */
export function bubblewrapArgs(mode: Mode): string[] {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"];
  if (mode !== "readonly" && mode !== "plan") {
    for (const root of writableRoots()) args.push("--bind-try", root, root);
  }
  // LAST, so it wins: bwrap applies binds in argv order, so re-binding these read-only after the
  // writable roots reinstates them however the allow list above was widened. Same guarantee as the
  // trailing deny in the Seatbelt profile.
  for (const p of protectedPaths()) args.push("--ro-bind-try", p, p);
  args.push("--chdir", projectRoot);
  return args;
}

// Run the candidate runner on a trivial command. A runner that exists but cannot actually start
// (missing entitlement, no user namespaces, a hardened container) must not be discovered later, in
// the middle of a real command — probe once, up front, and cache the verdict.
function probeRunner(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, windowsHide: true }, (err) => resolve(!err));
  });
}

/**
 * Decide once per process which runner (if any) confines commands here. Cached: the probe spawns a
 * process, and doing that before every run_bash would be both slow and pointless.
 */
export async function probeSandbox(): Promise<SandboxStatus> {
  if (probed) return probed;

  if (config.sandboxMode === "off") {
    probed = { kind: "off", reason: "BEECORK_SANDBOX=off" };
    return probed;
  }

  if (process.platform === "darwin") {
    const ok = await probeRunner("/usr/bin/sandbox-exec", ["-p", seatbeltProfile("normal"), "/usr/bin/true"]);
    probed = ok
      ? { kind: "active", runner: "seatbelt" }
      : { kind: "unavailable", reason: "sandbox-exec is present but refused to start a test process" };
    return probed;
  }

  if (process.platform === "linux") {
    const ok = await probeRunner("bwrap", [...bubblewrapArgs("normal"), "/bin/true"]);
    probed = ok
      ? { kind: "active", runner: "bubblewrap" }
      : { kind: "unavailable", reason: "bubblewrap (bwrap) is not installed or cannot create a namespace here" };
    return probed;
  }

  probed = { kind: "unavailable", reason: `no supported sandbox runner for platform "${process.platform}"` };
  return probed;
}

/** The cached verdict, or null before the probe has run. Shown in the status line. */
export const sandboxStatus = (): SandboxStatus | null => probed;

/**
 * Wrap a shell command so the OS confines it.
 *
 * Returns the spec to spawn, plus a `refusal` when the command must NOT run at all. Refusal happens
 * only under BEECORK_SANDBOX=on with no working runner — that setting means "confinement is
 * required", and quietly running unconfined would turn a security setting into a lie.
 */
export function wrapCommand(command: string, mode: Mode, status: SandboxStatus): { spec: SpawnSpec; refusal?: string } {
  const bare: SpawnSpec = { cmd: command, args: [], shell: true };

  if (status.kind === "active") {
    return status.runner === "seatbelt"
      ? { spec: { cmd: "/usr/bin/sandbox-exec", args: ["-p", seatbeltProfile(mode), "/bin/sh", "-c", command], shell: false } }
      : { spec: { cmd: "bwrap", args: [...bubblewrapArgs(mode), "/bin/sh", "-c", command], shell: false } };
  }
  if (status.kind === "off") return { spec: bare };

  // Wanted but unavailable.
  if (config.sandboxMode === "on") {
    return {
      spec: bare,
      refusal:
        `BEECORK_SANDBOX=on requires OS-level confinement, and none is available: ${status.reason}. ` +
        `Install a runner (Linux: bubblewrap), or set BEECORK_SANDBOX=auto to run with beecork's ` +
        `approval and denylist policy only.`,
    };
  }
  return { spec: bare };
}

/**
 * A one-time, visible notice that commands are running unconfined. The requirement the sandbox has
 * to meet is "never SILENTLY unsandboxed" — under the default `auto` we keep working on machines
 * without a runner, but the user is told once, plainly, rather than left to assume confinement.
 */
export function unconfinedNotice(status: SandboxStatus): string | null {
  if (status.kind !== "unavailable") return null;
  if (warned || config.sandboxMode === "off") return null;
  warned = true;
  return `commands run WITHOUT OS sandboxing — ${status.reason}. beecork's approval gate and command denylist still apply. Set BEECORK_SANDBOX=on to refuse instead.`;
}

/** Test-only: clear the cached probe so a test can drive a different platform/verdict. */
export function resetSandboxForTests(): void {
  probed = null;
  warned = false;
}
