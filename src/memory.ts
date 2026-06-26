// Project memory & settings: cork.md (human conventions) lives at each folder's
// ROOT; the machinery (memory.md, settings.json, sessions/) lives in each folder's
// .beecork/. We read+merge those plus the global ~/.beecork, with session save/restore.

import { readFile, writeFile, readdir, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { color } from "./ui";
import type { Message } from "./types";

const BEECORK = ".beecork";

// Folders from just below home down to cwd (top → down). cwd is last, so the
// most specific file wins (read last / overrides).
function ancestorDirs(): string[] {
  const home = homedir();
  const dirs: string[] = [];
  let dir = process.cwd();
  while (dir !== home && dir !== dirname(dir)) {
    dirs.push(dir);
    dir = dirname(dir);
  }
  return dirs.reverse();
}

// cork.md (human conventions) lives at each folder's ROOT, plus a global one.
function corkPaths(): string[] {
  return [join(homedir(), BEECORK, "cork.md"), ...ancestorDirs().map((d) => join(d, "cork.md"))];
}

// Machinery files (memory.md, settings.json) live in each folder's .beecork/.
function beecorkPaths(name: string): string[] {
  return [join(homedir(), BEECORK, name), ...ancestorDirs().map((d) => join(d, BEECORK, name))];
}

// Read cork.md + memory.md for the system prompt, SPLIT by trust: files under the
// global ~/.beecork are the user's own (authoritative); files in the project tree
// travel with a (possibly cloned) repo, so they're returned separately and framed
// as lower-trust context by the caller.
export async function loadInstructions(): Promise<{ trusted: string; project: string; sources: string[] }> {
  const home = homedir();
  const homeBeecork = join(home, ".beecork");
  const trusted: string[] = [];
  const project: string[] = [];
  const sources: string[] = [];
  for (const file of [...corkPaths(), ...beecorkPaths("memory.md")]) {
    try {
      const content = (await readFile(file, "utf8")).trim();
      if (!content) continue;
      const block = `## From ${file.replace(home, "~")}\n${content}`;
      (file.startsWith(homeBeecork) ? trusted : project).push(block);
      sources.push(file);
    } catch {
      // missing — skip
    }
  }
  return { trusted: trusted.join("\n\n"), project: project.join("\n\n"), sources };
}

// Read settings.json. `model` (a harmless preference) may come from any file in the
// tree. But `alwaysAllow` PRE-APPROVES dangerous tools (skips the approval gate), so
// it is honored ONLY from the user's global ~/.beecork/settings.json — never from a
// project file that travels with a (possibly cloned) repo. A project file that tries
// is flagged so the user is warned, not silently exposed.
export async function loadSettings(): Promise<{ model?: string; alwaysAllow: string[]; projectAlwaysAllowIgnored: boolean }> {
  const paths = beecorkPaths("settings.json"); // [0] = global ~/.beecork, rest = project tree
  let model: string | undefined;
  let alwaysAllow: string[] = [];
  let projectAlwaysAllowIgnored = false;
  for (let i = 0; i < paths.length; i++) {
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(await readFile(paths[i], "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(color.yellow(`⚠ ignoring malformed ${paths[i].replace(homedir(), "~")}: ${(err as Error).message}`));
      }
      continue; // missing → skip; malformed → warned above
    }
    if (typeof parsed.model === "string") model = parsed.model; // later/more-specific wins
    if (Array.isArray(parsed.alwaysAllow)) {
      if (i === 0) alwaysAllow = parsed.alwaysAllow.map(String); // global only
      else projectAlwaysAllowIgnored = true; // a project file tried → ignored + warned
    }
  }
  return { model, alwaysAllow, projectAlwaysAllowIgnored };
}

// ~/.beecork/config.json — the user's own machine-level config (their API key,
// etc.). Distinct from settings.json (project prefs) and cork.md (conventions).
function userConfigPath(): string {
  return join(homedir(), BEECORK, "config.json");
}

export async function loadUserConfig(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await readFile(userConfigPath(), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(color.yellow(`⚠ ignoring malformed ${userConfigPath().replace(homedir(), "~")}: ${(err as Error).message}`));
    }
    return {}; // missing → empty; malformed → warned above, then empty
  }
}

// Merge a patch into config.json (so saving a key doesn't clobber other fields),
// then lock the file to owner-only — it holds secrets.
export async function saveUserConfig(patch: Record<string, any>): Promise<void> {
  const file = userConfigPath();
  await mkdir(dirname(file), { recursive: true });
  const merged = { ...(await loadUserConfig()), ...patch };
  await writeFile(file, JSON.stringify(merged, null, 2), "utf8");
  try {
    await chmod(file, 0o600); // owner read/write only
  } catch {
    // best-effort (e.g. Windows) — ignore
  }
}

const sessionsDir = () => join(process.cwd(), BEECORK, "sessions");

// Save a conversation (without the system prompt) to .beecork/sessions/, for /resume.
export async function saveSession(messages: Message[]): Promise<void> {
  try {
    const dir = sessionsDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${Date.now()}.json`), JSON.stringify(messages), "utf8");
  } catch {
    // best-effort — ignore save errors
  }
}

// Load the most recent saved session's messages (for /resume).
export async function loadLatestSession(): Promise<Message[]> {
  try {
    const files = (await readdir(sessionsDir())).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) return [];
    return JSON.parse(await readFile(join(sessionsDir(), files[files.length - 1]), "utf8"));
  } catch {
    return [];
  }
}
