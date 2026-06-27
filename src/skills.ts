// Skills: user-defined slash commands. Each skill is a markdown file in
// `.beecork/skills/<name>.md` (project) or `~/.beecork/skills/<name>.md` (global).
// Invoking `/<name> [extra]` runs an agent turn whose prompt is the file's text
// (with `$ARGUMENTS` substituted, or the extra appended). A built-in command of
// the same name always wins; a project skill overrides a global one of the same name.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type Skill = { name: string; content: string; source: "project" | "global" };

const registry = new Map<string, Skill>();

export function skillNames(): string[] {
  return [...registry.keys()];
}
export function getSkill(name: string): Skill | undefined {
  return registry.get(name);
}

// Scan global then project (project overrides on a name clash). Best-effort: a
// missing folder or unreadable file is skipped, never fatal.
export async function loadSkills(): Promise<Skill[]> {
  registry.clear();
  const dirs: [string, "project" | "global"][] = [
    [join(homedir(), ".beecork", "skills"), "global"],
    [join(process.cwd(), ".beecork", "skills"), "project"],
  ];
  for (const [dir, source] of dirs) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue; // no skills folder here
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const name = e.name.slice(0, -3);
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) continue; // safe slug only (it becomes /name)
      try {
        const content = (await readFile(join(dir, e.name), "utf8")).trim();
        if (content) registry.set(name, { name, content, source });
      } catch {
        // unreadable — skip
      }
    }
  }
  return [...registry.values()];
}

// Expand a skill into the prompt to send the model: substitute $ARGUMENTS if the
// file uses it, otherwise append the extra text the user typed after /name.
export function expandSkill(skill: Skill, extra: string): string {
  return skill.content.includes("$ARGUMENTS")
    ? skill.content.replaceAll("$ARGUMENTS", extra)
    : skill.content + (extra ? `\n\n${extra}` : "");
}
