// The project's `.beecork/` directory — created through ONE chokepoint so everything beecork writes
// into a user's repo is covered by an ignore file.
//
// beecork is installed globally and runs inside OTHER people's repositories. It writes full
// transcripts (file contents, command output), an execution journal (every prompt, tool argument and
// shell command line), model-authored memory, and a browser-origin binding — all under `<cwd>/.beecork`.
// Nothing in the product ever wrote an ignore file, so a routine `git add -A` in a user's project
// commits their prompts and shell history, and pushing publishes them. The 0600 modes elsewhere are
// honest local protection and completely irrelevant to that path: git records only the executable bit.
//
// Fixing beecork's OWN .gitignore protects beecork's maintainers and nobody else, which is why the
// file has to travel with the feature.
//
// Three properties make writing into someone's repo defensible, and all three are load-bearing:
//   1. it lands ONLY inside a directory beecork itself just created — never the repo root, and it
//      never touches the user's own .gitignore;
//   2. it is created only when ABSENT and never modified (flag "wx"); the user's file always wins;
//   3. it is announced on the run that creates it, and says so in its own header.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { color } from "./ui";

const BEECORK = ".beecork";

// An explicit deny-list, NOT `*`. A bare `*` looks tidier and is actively harmful here: `.beecork/skills/`
// is a committed team feature (this repo tracks two of them), so `*` makes `git add .beecork/skills/x.md`
// fail and makes `git clean -fdx` delete the user's authored skills. `*` plus negations works but fails
// CLOSED — it would also hide settings.json and anything a future version puts here. A deny-list fails
// OPEN: a file beecork does not know about stays visible to git, which is the safe direction in a
// repository beecork does not own. Each entry carries its reason, so the file explains itself.
// NOTE: gitignore has no trailing comments — `sessions/  # transcripts` silently matches nothing.
const GITIGNORE = `# Created by beecork the first time it needed this folder.
#
# Everything listed below is machine-local runtime state, not source. It is kept out of git so a
# \`git add -A\` can't push your prompts, the file contents the agent read, and its shell history to a
# remote. beecork writes this file ONCE, only when it is absent, and never edits it again — delete or
# change it freely. Anything NOT listed here (skills/, settings.json, whatever you add) stays visible
# to git on purpose.

# Full conversation transcripts: file contents and command output the agent read.
sessions/

# Execution record: every prompt, tool argument, shell command line and absolute cwd.
journal/

# Conversations you rated with /good and /bad.
ratings/

# Notes the MODEL wrote about this project. They are injected into the system prompt on every run,
# so a copy travelling with a clone would instruct someone else's agent.
memory.md

# Which browser origin this checkout is bound to — a per-machine binding.
skeleton.json
`;

/**
 * Ensure `<cwd>/.beecork[/sub]` exists and that `.beecork/.gitignore` is in place, and return the
 * directory. Every writer that creates the project `.beecork/` goes through here.
 */
export async function ensureProjectBeecork(sub?: string): Promise<string> {
  const base = join(process.cwd(), BEECORK);
  const dir = sub ? join(base, sub) : base;
  await mkdir(dir, { recursive: true });
  try {
    // "wx" fails with EEXIST rather than truncating, so there is no exists-check race and no code
    // path that can overwrite a file the user edited. Only a genuine creation reaches the log line.
    await writeFile(join(base, ".gitignore"), GITIGNORE, { encoding: "utf8", flag: "wx" });
    console.error(color.dim("· wrote .beecork/.gitignore so transcripts and the journal stay out of git"));
  } catch {
    // EEXIST (the normal case) — or an unwritable repo, which must never stop beecork from running.
  }
  return dir;
}

/** The ignore-file text, exported so a test can assert what we promise to keep out of git. */
export const projectGitignore = (): string => GITIGNORE;
