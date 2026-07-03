// The security surface, in one place: what a reviewer must audit to trust the tools.
// Path confinement gating, secret-file gating, the two-tier shell-command lists +
// out-of-root detection, and the SSRF private-address check. All pure / near-pure
// (a resolveInRoot canonicalization is the only IO). The pure predicates
// (bashSafety, isPrivateAddr) and the secret-file gate are regression-tested in safety.test.ts.
// The tool registry (tools.ts) imports these to wire into each tool's guard.

import { homedir } from "node:os";
import { basename } from "node:path";
import { resolveInRoot } from "./paths";

// A file tool whose path lands outside the project root needs explicit approval.
export function pathGuard(args: Record<string, any>): { needsApproval?: boolean; reason?: string } {
  const { abs, inRoot } = resolveInRoot(String(args.path ?? "."));
  return inRoot ? {} : { needsApproval: true, reason: `path is outside the project root: ${abs}` };
}

// Files whose contents are secrets. read_file/show route these through approval even when
// in-root, `search` skips them, and write_file/edit_file route through it too (a planted
// .npmrc / overwritten .env is as dangerous as a leaked read) — so prompt-injected content
// can't silently read a key and exfiltrate it (e.g. via web_fetch) or plant credentials.
// `env` is in the extension group so `prod.env` / `config.env` are covered too, not just the
// `.env` dotfile; the leading `\.env(\.…)?` still handles `.env` and `.env.local` / `.env.production`.
export const SECRET_FILE = /(^|\/)(\.env(\.[\w.-]+)?|[\w.-]*\.(env|pem|key|secret|pfx|p12|jks|keystore)|id_(rsa|ed25519|ecdsa|dsa)|credentials|\.git-credentials|\.pgpass|\.npmrc|\.netrc)$/i;

// Does a user-supplied path resolve to a secrets file? Tests the CANONICAL resolved path
// (resolveInRoot already followed any symlinks), not the raw argument — otherwise an in-root
// symlink whose name doesn't match (notes.txt → ./prod.env) would slip a real secret past the gate.
function isSecretPath(userPath: string): boolean {
  const { abs } = resolveInRoot(userPath);
  return SECRET_FILE.test(abs) || SECRET_FILE.test(basename(abs)); // basename covers a non-"/" separator
}

// The gate for reads AND writes/edits: outside-root or secret-file → a per-CALL prompt
// (never "always"-cached; hard-denied in headless), so no secret is read or clobbered silently.
export function secretGuard(args: Record<string, any>): { needsApproval?: boolean; reason?: string } {
  const p = pathGuard(args);
  if (p.needsApproval) return p;
  const path = String(args.path ?? "");
  return isSecretPath(path)
    ? { needsApproval: true, reason: `this looks like a secrets file (${path}) — approve before continuing` }
    : {};
}
// Back-compat names used by the tool registry (read vs write are the same policy).
export const readGuard = secretGuard;
export const writeGuard = secretGuard;

// Two tiers of shell safety. DANGEROUS_BASH = never-legitimate catastrophes, refused
// OUTRIGHT (even if a confused human approves). RISKY_BASH = powerful-but-sometimes-
// legitimate commands that must keep a human in the loop: they get the per-CALL guard
// (asked EVERY time, never "always"-cached; hard-denied in headless mode). A regex can
// never be exhaustive, so the human / headless-block is the real protection — these
// lists only decide what needs one.
export const DANGEROUS_BASH: RegExp[] = [
  /\brm\b[\s\S]*\s(\/|~|\$\{?HOME\}?)\/?(\s*$|\*|\/\*)/, // rm of / ~ $HOME (and their immediate /*)
  /\brm\b[\s\S]*\s\/(etc|usr|bin|sbin|lib|var|boot|dev|sys|proc|root|System|Library|Applications)(\/|\s|$|\*)/, // rm of a system root
  /:\s*\(\s*\)\s*\{[^}]*\}\s*;\s*:/, // fork bomb :(){ :|:& };:
  /\bmkfs\.?\w*/, // format a filesystem
  /\bdd\b[^\n]*\bof=\/dev\//, // dd to a raw device
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // pipe-to-shell
  />\s*\/dev\/(sd|nvme|disk)/, // overwrite a disk device
];
export const RISKY_BASH: RegExp[] = [
  /\b(rm|rmdir|shred|unlink)\b/, // deleting files
  /\bfind\b[\s\S]*\s-(delete|exec)\b/, // find -delete / -exec (mass mutate without "rm")
  /\btruncate\b/, // truncate files to a size
  /(^|[\s;&|])(:|true)\s*>\s*\S/, // `: > file` / `true > file` truncation idiom
  /\b(dd|fdisk|parted|wipefs|sgdisk)\b/, // raw disk tools
  /\bmkfs\.?\w*/, // make a filesystem
  /\bsudo\b/, // privilege escalation
  /[<>]\s*\/dev\/\w/, // raw device I/O
  /\|\s*(sudo\s+)?(sh|bash|zsh|python\d?|node|perl|ruby|php)\b/, // pipe INTO an interpreter
  /\b(eval|source)\b[\s\S]*\$\(\s*(curl|wget|fetch)\b/, // eval/source of a download
];

// Heuristic out-of-root detector for run_bash: parent-dir escapes, ~ home refs, and
// space/quote-anchored absolute paths that resolve outside the project root (URLs are
// skipped naturally — their "/" follows ":"). Not a true sandbox (the roadmap defers
// that), but it routes shell access to outside paths through the gate too, instead of
// relying only on a prompt-text deterrent.
export function refsOutsideRoot(cmd: string): boolean {
  // Normalize common shell expansions/obfuscations first so they can't smuggle an
  // out-of-root path past the anchors: ${IFS}→space, $HOME/$PWD/~ → their real paths.
  const norm = cmd
    .replace(/\$\{?IFS\}?/g, " ")
    .replace(/\$\{?HOME\}?/g, homedir())
    .replace(/\$\{?PWD\}?/g, process.cwd())
    .replace(/(^|[\s"'`=(])~(?=\/|$)/g, (_m, p) => p + homedir());
  if (/(^|[\s"'`=(])(\.\.\/|~(\/|$))/.test(norm)) return true; // ../ escape or ~ home ref
  for (const m of norm.matchAll(/(?:^|[\s"'`=(])(\/[^\s"'`;|&()<>]*)/g)) {
    if (!resolveInRoot(m[1]).inRoot) return true; // an absolute path outside the root
  }
  return false;
}
export function bashGuard(args: Record<string, any>): { needsApproval?: boolean; reason?: string } {
  const cmd = String(args.command ?? "");
  const risky = RISKY_BASH.find((re) => re.test(cmd));
  if (risky) return { needsApproval: true, reason: `this shell command looks risky (matched ${risky})` };
  if (refsOutsideRoot(cmd)) return { needsApproval: true, reason: "this shell command references a path outside the project root" };
  return {};
}

// Inspection seam for the shell-safety predicates (regression-tested in safety.test.ts).
export function bashSafety(cmd: string): { dangerous: boolean; risky: boolean; outsideRoot: boolean } {
  return {
    dangerous: DANGEROUS_BASH.some((re) => re.test(cmd)),
    risky: RISKY_BASH.some((re) => re.test(cmd)),
    outsideRoot: refsOutsideRoot(cmd),
  };
}

// SSRF guard: reject hosts that resolve to a private/loopback/link-local/internal
// address (incl. the cloud metadata endpoint 169.254.169.254). Used by httpGet's
// connect-time lookup (tools.ts) to pin + vet every address.
export function isPrivateAddr(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = +m[1], b = +m[2];
    return a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // IPv6 — normalize, then check numerically (text-prefix matching misses non-canonical forms).
  const ip6 = ip.toLowerCase();
  const dotted = ip6.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:a.b.c.d / ::a.b.c.d
  if (dotted) return isPrivateAddr(dotted[1]);
  const g = expandIPv6(ip6);
  if (!g) return true; // unparseable → fail closed
  if (g.every((h) => h === 0)) return true; // :: (unspecified)
  if (g.slice(0, 7).every((h) => h === 0) && g[7] === 1) return true; // ::1 loopback
  const embeddedV4 = () => `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
  // IPv4-mapped ::ffff:HHHH:HHHH → check the embedded v4
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isPrivateAddr(embeddedV4());
  }
  // NAT64 64:ff9b::/96 and the deprecated IPv4-compatible ::/96 also embed an IPv4 in the low
  // 32 bits — a NAT64 gateway translates the first to that v4 (e.g. 64:ff9b::a9fe:a9fe →
  // 169.254.169.254 metadata). Vet the embedded address. (:: and ::1 were handled above.)
  if ((g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) ||
      (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0)) {
    return isPrivateAddr(embeddedV4());
  }
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}
// Expand an IPv6 text address to 8 numeric hextets, or null if invalid.
function expandIPv6(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(":").map((h) => parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  if (halves.length === 1) return head.length === 8 && head.every((n) => n >= 0 && n <= 0xffff) ? head : null;
  const tail = parse(halves[1]);
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  const g = [...head, ...Array(fill).fill(0), ...tail];
  return g.length === 8 && g.every((n) => Number.isFinite(n) && n >= 0 && n <= 0xffff) ? g : null;
}
