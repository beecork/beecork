// Project memory & settings: cork.md (human conventions) lives at each folder's
// ROOT; the machinery (memory.md, settings.json, sessions/) lives in each folder's
// .beecork/. We read+merge those plus the global ~/.beecork, with session save/restore.

import { readFile, writeFile, readdir, mkdir, chmod, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { color, stripControl } from "./ui";
import { normalizeEffort } from "./config";
import type { ReasoningEffort } from "./config";
import { projectRoot, tildify } from "./paths";
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

// Standard, cross-tool project instructions: AGENTS.md (the emerging convention any agent CLI reads)
// and CLAUDE.md (Claude Code's). Project tree ONLY — these are repo files, so they're read at the
// lower-trust "project" tier (like project cork.md), never as authoritative. Lets beecork "just work"
// in repos that ship them, instead of needing a beecork-specific file.
function standardInstructionPaths(): string[] {
  return ancestorDirs().flatMap((d) => [join(d, "AGENTS.md"), join(d, "CLAUDE.md")]);
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
  // Budget the instruction text so a large checked-in cork.md/memory.md can't silently
  // tax every request (it lands in the system prompt, which compaction can't trim).
  const MAX_FILE = 8_000;
  const MAX_TOTAL = 24_000;
  let total = 0;
  for (const file of [...corkPaths(), ...standardInstructionPaths(), ...beecorkPaths("memory.md")]) {
    try {
      let content = (await readFile(file, "utf8")).trim();
      if (!content) continue;
      if (content.length > MAX_FILE) content = content.slice(0, MAX_FILE) + "\n…(truncated)";
      if (total + content.length > MAX_TOTAL) content = content.slice(0, Math.max(0, MAX_TOTAL - total)) + "\n…(truncated)";
      total += content.length;
      const block = `## From ${tildify(file)}\n${content}`;
      (file.startsWith(homeBeecork) ? trusted : project).push(block);
      sources.push(file);
      if (total >= MAX_TOTAL) break;
    } catch {
      // missing — skip
    }
  }
  return { trusted: trusted.join("\n\n"), project: project.join("\n\n"), sources };
}

// Read+parse a JSON config file. Missing → null silently; malformed → warn (don't crash) → null.
async function readJsonFile(path: string): Promise<Record<string, any> | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(color.yellow(`⚠ ignoring malformed ${tildify(path)}: ${(err as Error).message}`));
    }
    return null;
  }
}

// Read settings.json. `model` (a harmless preference) may come from any file in the
// tree. But `alwaysAllow` PRE-APPROVES dangerous tools (skips the approval gate), so
// it is honored ONLY from the user's global ~/.beecork/settings.json — never from a
// project file that travels with a (possibly cloned) repo. A project file that tries
// is flagged so the user is warned, not silently exposed.
export async function loadSettings(): Promise<{ model?: string; reasoningEffort?: ReasoningEffort; alwaysAllow: string[]; projectAlwaysAllowIgnored: boolean }> {
  const paths = beecorkPaths("settings.json"); // [0] = global ~/.beecork, rest = project tree
  let model: string | undefined;
  let reasoningEffort: ReasoningEffort | undefined;
  let alwaysAllow: string[] = [];
  let projectAlwaysAllowIgnored = false;
  for (let i = 0; i < paths.length; i++) {
    const parsed = await readJsonFile(paths[i]);
    if (!parsed) continue; // missing → skip; malformed → warned by readJsonFile
    if (typeof parsed.model === "string") model = parsed.model; // later/more-specific wins
    if (typeof parsed.reasoningEffort === "string") reasoningEffort = normalizeEffort(parsed.reasoningEffort) ?? reasoningEffort; // ignore a garbage value
    if (Array.isArray(parsed.alwaysAllow)) {
      if (i === 0) alwaysAllow = parsed.alwaysAllow.map(String); // global only
      else projectAlwaysAllowIgnored = true; // a project file tried → ignored + warned
    }
  }
  return { model, reasoningEffort, alwaysAllow, projectAlwaysAllowIgnored };
}

// ~/.beecork/config.json — the user's own machine-level config (their API key,
// etc.). Distinct from settings.json (project prefs) and cork.md (conventions).
function userConfigPath(): string {
  return join(homedir(), BEECORK, "config.json");
}

export async function loadUserConfig(): Promise<Record<string, any>> {
  return (await readJsonFile(userConfigPath())) ?? {}; // missing/malformed → empty (warned)
}

// Merge a patch into config.json (so saving a key doesn't clobber other fields). Written
// atomically via a temp file created owner-only (mode 0600) then renamed — so the secret is
// never briefly world-readable (default umask) and a crash mid-write can't truncate it.
export async function saveUserConfig(patch: Record<string, any>): Promise<void> {
  const file = userConfigPath();
  await mkdir(dirname(file), { recursive: true });
  const merged = { ...(await loadUserConfig()), ...patch };
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(merged, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {}); // enforce owner-only even if umask/pre-existing tmp differed
  await rename(tmp, file);
}

// Persist the chosen model to the global settings.json (merge, so alwaysAllow etc. survive), so
// /model sticks across restarts like /key does. Best-effort — a save failure never breaks the session.
export async function saveModelPreference(model: string): Promise<void> {
  try {
    const file = join(homedir(), BEECORK, "settings.json");
    await mkdir(dirname(file), { recursive: true });
    const current = (await readJsonFile(file)) ?? {};
    await writeFile(file, JSON.stringify({ ...current, model }, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

// Persist the chosen reasoning effort to the global settings.json (merge), so /effort sticks
// across restarts like /model. Best-effort — a save failure never breaks the session.
export async function saveReasoningPreference(reasoningEffort: string): Promise<void> {
  try {
    const file = join(homedir(), BEECORK, "settings.json");
    await mkdir(dirname(file), { recursive: true });
    const current = (await readJsonFile(file)) ?? {};
    await writeFile(file, JSON.stringify({ ...current, reasoningEffort }, null, 2), "utf8");
  } catch {
    // best-effort
  }
}

const sessionsDir = () => join(process.cwd(), BEECORK, "sessions");

// Save a conversation (without the system prompt) to .beecork/sessions/, for /resume.
// Atomic (temp file + rename) so a crash mid-write can't truncate a session, and owner-only
// (the transcript may contain file contents / command output the model read).
export async function saveSession(messages: Message[]): Promise<void> {
  try {
    const dir = sessionsDir();
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${Date.now()}.json`);
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(messages), "utf8");
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, file);
    await pruneSessions(dir).catch(() => {}); // keep .beecork/sessions/ bounded; best-effort
  } catch {
    // best-effort — ignore save errors
  }
}

const MAX_SESSIONS = 50; // per project; /resume rarely needs more, and the dir shouldn't grow forever
async function pruneSessions(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  if (files.length <= MAX_SESSIONS) return;
  // Filenames are `${Date.now()}.json` (fixed-width ms) → lexical sort == chronological. Drop the oldest.
  for (const f of files.sort().slice(0, files.length - MAX_SESSIONS)) await unlink(join(dir, f)).catch(() => {});
}

// Validate + sanitize a restored session. Sessions are saved WITHOUT the system prompt,
// so a `system` message in a project session file is planted injection — drop it. Reject
// the whole session if any message has an invalid shape (don't feed garbage to the model).
// Exported for the trust-tier regression test (safety-critical: it strips planted system roles).
export function sanitizeSession(raw: unknown): Message[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Message[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return null;
    const role = (m as { role?: unknown }).role;
    if (role === "system") continue; // not legitimately in a saved session
    if (role !== "user" && role !== "assistant" && role !== "tool") return null;
    const content = (m as { content?: unknown }).content;
    if (content != null && typeof content !== "string") return null;
    const msg: Message = { role, content: (content as string) ?? null };
    const tc = (m as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(tc)) msg.tool_calls = tc as Message["tool_calls"];
    const tcid = (m as { tool_call_id?: unknown }).tool_call_id;
    if (typeof tcid === "string") msg.tool_call_id = tcid;
    out.push(msg);
  }
  return dropIncompleteToolTail(out);
}

// A crash / SIGTERM / SIGHUP *during* a turn bypasses runTurn's abort-rollback and can persist the
// conversation mid-tool-group — a trailing assistant with tool_calls whose tool results weren't all
// pushed yet. Resuming that would send an assistant→tool group with a missing result, which providers
// reject. So drop the trailing incomplete group (rollback-style, matching runTurn's snapshot behavior —
// discard the incomplete turn rather than backfill placeholder results). Exported for the test.
export function dropIncompleteToolTail(messages: Message[]): Message[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls?.length) {
      const unanswered = new Set(m.tool_calls.map((t) => t.id));
      for (let j = i + 1; j < messages.length; j++) {
        const mj = messages[j];
        if (mj.role === "tool" && mj.tool_call_id) unanswered.delete(mj.tool_call_id);
        else break; // a non-tool message ends this tool group
      }
      return unanswered.size > 0 ? messages.slice(0, i) : messages; // incomplete → drop from this assistant on
    }
  }
  return messages;
}

// Read + validate one session file by name. Returns null on missing/corrupt/invalid.
async function readSession(file: string): Promise<Message[] | null> {
  try {
    const path = join(sessionsDir(), file);
    const parsed = sanitizeSession(JSON.parse(await readFile(path, "utf8")));
    await chmod(path, 0o600).catch(() => {}); // lock down sessions written before the 0600 hardening
    return parsed;
  } catch {
    return null;
  }
}

// Load the most recent VALID saved session (for /resume), scanning newest→oldest so one
// corrupt latest file doesn't hide older good sessions.
export async function loadLatestSession(): Promise<Message[]> {
  try {
    const files = (await readdir(sessionsDir())).filter((f) => f.endsWith(".json")).sort();
    for (let i = files.length - 1; i >= 0; i--) {
      const sane = await readSession(files[i]);
      if (sane && sane.length) return sane;
    }
    return [];
  } catch {
    return [];
  }
}

// List saved sessions (newest first) with a preview, so /resume can offer a picker.
export async function listSessions(): Promise<{ file: string; when: number; count: number; preview: string }[]> {
  try {
    const files = (await readdir(sessionsDir())).filter((f) => f.endsWith(".json"));
    const out: { file: string; when: number; count: number; preview: string }[] = [];
    for (const f of files) {
      const msgs = await readSession(f);
      if (!msgs || !msgs.length) continue;
      const firstUser = msgs.find((m) => m.role === "user");
      // stripControl: session files are repo-controlled — a planted session must not inject terminal
      // escapes through the /resume picker label.
      const preview = stripControl(firstUser?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
      out.push({ file: f, when: Number(f.replace(".json", "")) || 0, count: msgs.length, preview });
    }
    return out.sort((a, b) => b.when - a.when);
  } catch {
    return [];
  }
}

// Load one specific session by filename (validated).
export async function loadSession(file: string): Promise<Message[]> {
  return (await readSession(file)) ?? [];
}

// Per-PROJECT tool pre-approvals (the "always" answer), persisted across restarts but scoped
// to THIS project's path. Stored in ~/.beecork (the user's own machine) — NOT in the repo — and
// keyed by the canonical project root, so a cloned/shared repo can't carry a pre-approval.
function projectApprovalsPath(): string {
  return join(homedir(), BEECORK, "project-approvals.json");
}
export async function loadProjectApprovals(): Promise<string[]> {
  const all = await readJsonFile(projectApprovalsPath()); // warns on malformed, like the other config readers
  const list = all?.[projectRoot];
  return Array.isArray(list) ? list.map(String) : [];
}
export async function addProjectApproval(tool: string): Promise<void> {
  try {
    const file = projectApprovalsPath();
    await mkdir(dirname(file), { recursive: true });
    const all: Record<string, any> = (await readJsonFile(file)) ?? {};
    const list = new Set<string>(Array.isArray(all[projectRoot]) ? all[projectRoot] : []);
    list.add(tool);
    all[projectRoot] = [...list];
    await writeFile(file, JSON.stringify(all, null, 2), "utf8");
    await chmod(file, 0o600).catch(() => {});
  } catch {
    // best-effort
  }
}
