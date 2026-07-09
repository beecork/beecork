// Runtime environment facts injected into the system prompt, so the model works from REALITY
// instead of guessing (the date, git state, tool availability). Kept TIGHT — a few high-signal
// facts, not a data dump (token economy). Gathering is best-effort: any probe that fails degrades
// gracefully; formatting is pure (formatRuntimeContext) so it can be unit-tested without spawning.

import { execFile } from "node:child_process";
import { platform, arch } from "node:os";

export type RuntimeFacts = {
  date: string; // YYYY-MM-DD
  cwd: string;
  platform: string;
  node: string;
  git: string; // "branch main (clean)" | "branch main (3 uncommitted changes)" | "not a git repo"
  ripgrep: boolean;
};

// Run a command with a short timeout; resolve its trimmed stdout, or null on ANY failure
// (missing binary, non-zero exit, timeout). Never throws — the caller degrades gracefully.
function tryExec(cmd: string, args: string[], timeout = 2000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
    } catch {
      resolve(null);
    }
  });
}

async function gitStatus(): Promise<string> {
  const branch = await tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === null) return "not a git repo";
  const porcelain = await tryExec("git", ["status", "--porcelain"]);
  if (porcelain === null) return `branch ${branch}`;
  const dirty = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  return `branch ${branch} (${dirty ? `${dirty} uncommitted change${dirty === 1 ? "" : "s"}` : "clean"})`;
}

// Pure: render gathered facts into the prompt block. Tested in isolation.
export function formatRuntimeContext(f: RuntimeFacts): string {
  return [
    "# Environment",
    `- Date: ${f.date}`,
    `- Working directory: ${f.cwd}`,
    `- Platform: ${f.platform}`,
    `- Node: ${f.node}`,
    `- Git: ${f.git}`,
    `- ripgrep (rg): ${f.ripgrep ? "available" : "not installed"}`,
  ].join("\n");
}

// Gather the facts (best-effort IO) and format them. Called once at startup.
export async function runtimeContext(): Promise<string> {
  const [git, rg] = await Promise.all([gitStatus(), tryExec("rg", ["--version"])]);
  return formatRuntimeContext({
    date: new Date().toISOString().slice(0, 10),
    cwd: process.cwd(),
    platform: `${platform()} ${arch()}`,
    node: process.version,
    git,
    ripgrep: rg !== null,
  });
}
