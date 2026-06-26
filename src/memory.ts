// Project memory & settings: read cork.md (conventions, you write) and
// memory.md (facts the agent remembers) from .beecork folders, plus session
// save/restore. All folder/file-specific data lives in .beecork/.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { Message } from "./types";

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
  return [join(homedir(), ".beecork", "cork.md"), ...ancestorDirs().map((d) => join(d, "cork.md"))];
}

// Machinery files (memory.md, settings.json) live in each folder's .beecork/.
function beecorkPaths(name: string): string[] {
  return [join(homedir(), ".beecork", name), ...ancestorDirs().map((d) => join(d, ".beecork", name))];
}

// Read + merge cork.md and memory.md. Both get injected into the system prompt.
export async function loadInstructions(): Promise<{ text: string; sources: string[] }> {
  const home = homedir();
  const parts: string[] = [];
  const sources: string[] = [];
  for (const file of [...corkPaths(), ...beecorkPaths("memory.md")]) {
    try {
      const content = (await readFile(file, "utf8")).trim();
      if (content) {
        parts.push(`## From ${file.replace(home, "~")}\n${content}`);
        sources.push(file);
      }
    } catch {
      // missing — skip
    }
  }
  return { text: parts.join("\n\n"), sources };
}

// Read + merge all settings.json files (later/more-specific overrides earlier).
export async function loadSettings(): Promise<Record<string, any>> {
  let merged: Record<string, any> = {};
  for (const file of beecorkPaths("settings.json")) {
    try {
      merged = { ...merged, ...JSON.parse(await readFile(file, "utf8")) };
    } catch {
      // missing or invalid JSON — skip
    }
  }
  return merged;
}

// Save a conversation (without the system prompt) to .beecork/sessions/, for /resume.
export async function saveSession(messages: Message[]): Promise<void> {
  try {
    const dir = join(process.cwd(), ".beecork", "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${Date.now()}.json`), JSON.stringify(messages), "utf8");
  } catch {
    // best-effort — ignore save errors
  }
}

// Load the most recent saved session's messages (for /resume).
export async function loadLatestSession(): Promise<Message[]> {
  try {
    const dir = join(process.cwd(), ".beecork", "sessions");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) return [];
    return JSON.parse(await readFile(join(dir, files[files.length - 1]), "utf8"));
  } catch {
    return [];
  }
}
