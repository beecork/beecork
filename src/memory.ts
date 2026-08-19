// Project memory & settings: cork.md (human conventions) lives at each folder's
// ROOT; the machinery (memory.md, settings.json, sessions/) lives in each folder's
// .beecork/. We read+merge those plus the global ~/.beecork, with session save/restore.

import { readFile, writeFile, readdir, mkdir, chmod, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, sep } from "node:path";
import { color, stripControl } from "./ui";
import { normalizeEffort, config } from "./config";
import type { ReasoningEffort } from "./config";
import { projectRoot, tildify } from "./paths";
import { textOf, stripImagesForSave } from "./images";
import { neutralize, neutralizeBlock } from "./html";
import { ensureProjectBeecork } from "./beecorkDir";
import type { Message, Content, ContentPart, ToolCall } from "./types";

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
      // The TRUSTED tier is the user's own file and stays byte-exact — stripping chat-template
      // markers there would mangle a cork.md that legitimately documents them (this repo's html.ts
      // does). The PROJECT tier travels with a possibly-cloned repo, so it is neutralized: without it
      // an AGENTS.md could contain a byte-exact copy of the tier-1 section heading and, appearing
      // AFTER the "untrusted" warning, supersede it — later markdown headings win.
      const isTrusted = file.startsWith(homeBeecork + sep); // + sep: "~/.beecork-notes/x" is NOT trusted
      const block = `## From ${neutralize(tildify(file), 200)}\n${isTrusted ? content : neutralizeBlock(content, MAX_FILE)}`;
      (isTrusted ? trusted : project).push(block);
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
// Files written before the owner-only hardening keep their old mode until something rewrites them.
// settings.json in particular holds alwaysAllow and per-MCP-server env credentials, and a user who
// never touches /model again would never trigger a rewrite. Once per process, best-effort.
let modesRepaired = false;
async function repairHomeModes(): Promise<void> {
  if (modesRepaired) return;
  modesRepaired = true;
  const home = join(homedir(), BEECORK);
  for (const f of ["settings.json", "config.json", "project-approvals.json", join("skeleton", "dev-signals.jsonl"), join("skeleton", ".beecork-token")]) {
    await chmod(join(home, f), 0o600).catch(() => {}); // ENOENT → nothing to fix
  }
}

export async function loadSettings(): Promise<{ model?: string; reasoningEffort?: ReasoningEffort; alwaysAllow: string[]; projectAlwaysAllowIgnored: boolean; mcpServers: Record<string, unknown>; projectMcpIgnored: boolean }> {
  await repairHomeModes();
  const paths = beecorkPaths("settings.json"); // [0] = global ~/.beecork, rest = project tree
  let model: string | undefined;
  let reasoningEffort: ReasoningEffort | undefined;
  let alwaysAllow: string[] = [];
  let projectAlwaysAllowIgnored = false;
  let mcpServers: Record<string, unknown> = {};
  let projectMcpIgnored = false;
  for (let i = 0; i < paths.length; i++) {
    const parsed = await readJsonFile(paths[i]);
    if (!parsed) continue; // missing → skip; malformed → warned by readJsonFile
    if (typeof parsed.model === "string") model = parsed.model; // later/more-specific wins
    if (typeof parsed.reasoningEffort === "string") reasoningEffort = normalizeEffort(parsed.reasoningEffort) ?? reasoningEffort; // ignore a garbage value
    if (Array.isArray(parsed.alwaysAllow)) {
      if (i === 0) alwaysAllow = parsed.alwaysAllow.map(String); // global only
      else projectAlwaysAllowIgnored = true; // a project file tried → ignored + warned
    }
    // Same global-only rule as alwaysAllow, and for a stronger reason: an mcpServers entry spawns an
    // arbitrary binary with arbitrary args, cwd and env. alwaysAllow only pre-approves a tool beecork
    // already wrote; this would run someone else's program. A cloned repo must never be able to.
    if (parsed.mcpServers && typeof parsed.mcpServers === "object" && !Array.isArray(parsed.mcpServers)) {
      if (i === 0) mcpServers = parsed.mcpServers as Record<string, unknown>; // global only
      else projectMcpIgnored = true; // a project file tried → ignored + warned
    }
  }
  return { model, reasoningEffort, alwaysAllow, projectAlwaysAllowIgnored, mcpServers, projectMcpIgnored };
}

// ~/.beecork/config.json — the user's own machine-level config (their API key,
// etc.). Distinct from settings.json (project prefs) and cork.md (conventions).
function userConfigPath(): string {
  return join(homedir(), BEECORK, "config.json");
}

export async function loadUserConfig(): Promise<Record<string, any>> {
  return (await readJsonFile(userConfigPath())) ?? {}; // missing/malformed → empty (warned)
}

/**
 * Write `text` to `file` atomically and owner-only. THE write path for anything private.
 *
 * The bytes are never world-readable, not even for an instant: the temp is CREATED 0600 via `mode:`
 * (umask can only clear bits, never add them) and re-chmod'd in case a crash-leftover temp with
 * looser bits was reused — a measured hazard, `mode:` is ignored when the file already exists.
 * `rename` preserves the source inode's mode, so a pre-existing 0644 target is REPLACED by a 0600
 * file: routing the writers through here also self-heals the loose files already on disk.
 *
 * The temp name is unique per process+call. The old fixed `${file}.tmp` meant two beecork instances
 * (two terminals, same project) could rename each other's half-written file into place.
 */
export async function writePrivate(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, file);
  } catch (err) {
    await unlink(tmp).catch(() => {}); // never leave a private-data temp behind
    throw err;
  }
}

/** The config-file case: pretty JSON, same atomic + owner-only guarantees. */
export const writeJsonPrivate = (file: string, data: unknown): Promise<void> =>
  writePrivate(file, JSON.stringify(data, null, 2));

// Merge a patch into config.json (so saving a key doesn't clobber other fields).
export async function saveUserConfig(patch: Record<string, any>): Promise<void> {
  await writeJsonPrivate(userConfigPath(), { ...(await loadUserConfig()), ...patch });
}

// Persist the chosen model to the global settings.json (merge, so alwaysAllow etc. survive), so
// /model sticks across restarts like /key does. Best-effort — a save failure never breaks the session.
export async function saveModelPreference(model: string): Promise<void> {
  try {
    const file = join(homedir(), BEECORK, "settings.json");
    await mkdir(dirname(file), { recursive: true });
    const current = (await readJsonFile(file)) ?? {};
    await writeJsonPrivate(file, { ...current, model });
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
    await writeJsonPrivate(file, { ...current, reasoningEffort });
  } catch {
    // best-effort
  }
}

const sessionsDir = () => join(process.cwd(), BEECORK, "sessions");

// What persist() writes: the live conversation SEALED, without the system prompt.
// runTurn's abort/error paths already seal, but the SIGNAL and CRASH paths write the raw live array —
// which legitimately sits mid-tool-group. Saving that unsealed is how closing your terminal mid-edit
// lost the edit: the file was on disk, the restored transcript said the turn never happened.
export function sessionForSave(messages: Message[]): Message[] {
  return sealInterruptedToolCalls(messages).slice(1);
}

// Save a conversation (without the system prompt) to .beecork/sessions/, for /resume.
// Atomic (temp file + rename) so a crash mid-write can't truncate a session, and owner-only
// (the transcript may contain file contents / command output the model read).
export async function saveSession(messages: Message[]): Promise<void> {
  try {
    const dir = await ensureProjectBeecork("sessions");
    const file = join(dir, `${Date.now()}.json`);
    // Strip image payloads: a session is for resuming a conversation, not archiving pixels. Keeping
    // them would put megabytes per file under .beecork/sessions/ (50 of them) and make /resume,
    // which parses every file to build its picker, crawl.
    await writePrivate(file, JSON.stringify(stripImagesForSave(messages)));
    await pruneSessions(dir).catch(() => {}); // keep .beecork/sessions/ bounded; best-effort
  } catch {
    // best-effort — ignore save errors
  }
}

const MAX_SESSIONS = 50; // per project; /resume rarely needs more, and the dir shouldn't grow forever
async function pruneSessions(dir: string): Promise<void> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  // Sessions written before the owner-only hardening are still 0644. Repair them here rather than
  // only on read: a session that is never /resume'd would otherwise stay world-readable forever.
  for (const f of files) await chmod(join(dir, f), 0o600).catch(() => {});
  if (files.length <= MAX_SESSIONS) return;
  // Filenames are `${Date.now()}.json` (fixed-width ms) → lexical sort == chronological. Drop the oldest.
  for (const f of files.sort().slice(0, files.length - MAX_SESSIONS)) await unlink(join(dir, f)).catch(() => {});
}

// Only a self-contained base64 data URL of an allowed image type, under the size cap.
//
// http(s) URLs are REJECTED ON PURPOSE, and this is the security point of the whole function:
// session files live in the repo's .beecork/sessions/, so a cloned repo can plant one. A planted
// message containing a remote image URL would make the PROVIDER fetch that URL the instant the user
// runs /resume — a zero-click beacon (and a plausible exfiltration channel via the path). beecork
// itself never emits an http image URL (it always base64s local bytes), so refusing them costs
// nothing real.
const isSafeImageUrl = (u: unknown): boolean =>
  typeof u === "string" &&
  /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(u) &&
  u.length <= config.maxImageBytes * 2; // base64 inflates ~1.37×; 2× is a loose but finite ceiling

const INVALID = Symbol("invalid-content");

// Widen the content check STRUCTURALLY rather than by loosening it: a parts array is accepted only
// when every element is a well-formed text or image part. Anything else still rejects the whole
// session, which is the existing (deliberate) behavior for a malformed file.
function sanitizeContent(content: unknown): Content | typeof INVALID {
  if (content == null) return null;
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || !content.length) return INVALID;
  const parts: ContentPart[] = [];
  for (const p of content) {
    if (!p || typeof p !== "object") return INVALID;
    const t = (p as { type?: unknown }).type;
    if (t === "text" && typeof (p as { text?: unknown }).text === "string") {
      parts.push({ type: "text", text: (p as { text: string }).text });
    } else if (t === "image_url" && isSafeImageUrl((p as { image_url?: { url?: unknown } }).image_url?.url)) {
      parts.push({ type: "image_url", image_url: { url: (p as { image_url: { url: string } }).image_url.url } });
    } else return INVALID;
  }
  return parts;
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
    const content = sanitizeContent((m as { content?: unknown }).content);
    if (content === INVALID) return null;
    const msg: Message = { role, content };
    const tc = (m as { tool_calls?: unknown }).tool_calls;
    if (tc !== undefined) {
      if (!Array.isArray(tc)) return null;
      const calls = sanitizeToolCalls(tc);
      if (calls === INVALID) return null;
      if (calls.length) msg.tool_calls = calls;
    }
    const tcid = (m as { tool_call_id?: unknown }).tool_call_id;
    if (typeof tcid === "string") msg.tool_call_id = tcid;
    out.push(msg);
  }
  // A `tool` result whose call appears nowhere above it is a FORGED result — the shape that plants
  // "the user already approved run_bash" into history. Providers reject it too. dropIncompleteToolTail
  // only ever guarded the TAIL, so this was reachable anywhere earlier in the file.
  const called = new Set<string>();
  for (const m of out) {
    if (m.role === "assistant") for (const c of m.tool_calls ?? []) called.add(c.id);
    if (m.role === "tool" && (!m.tool_call_id || !called.has(m.tool_call_id))) return null;
  }
  // SEAL rather than truncate. The old dropIncompleteToolTail deleted the whole trailing group, which
  // is how a crash-persisted session lost tool work that had already reached the disk (the file was
  // written, the transcript said it never happened). Sealing keeps every completed result and
  // backfills a note for the calls that never ran.
  return sealInterruptedToolCalls(out);
}

// A restored session's tool_calls go straight to the provider AND into sealInterruptedToolCalls,
// which indexes call.id. Session files live in the repo, so a cloned repo can plant one: validate the
// shape structurally instead of casting, with the same deny-first rule sanitizeContent uses.
// (A planted `tool_calls: [null]` used to THROW here, which readSession swallowed — so the session
// silently vanished from /resume and from the picker.)
function sanitizeToolCalls(raw: unknown[]): ToolCall[] | typeof INVALID {
  const out: ToolCall[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") return INVALID;
    const { id, function: fn } = c as { id?: unknown; function?: unknown };
    if (typeof id !== "string" || !id) return INVALID;
    if (!fn || typeof fn !== "object") return INVALID;
    const { name, arguments: args } = fn as { name?: unknown; arguments?: unknown };
    if (typeof name !== "string" || !name || typeof args !== "string") return INVALID;
    out.push({ id, type: "function", function: { name, arguments: args } });
  }
  return out;
}


// The note a never-started tool call gets when a turn is cut short. handleToolCall pushes exactly
// one result on EVERY path, so an unanswered call id can only mean the loop stopped before reaching
// it — "did not run" is a fact here, not a guess.
export const INTERRUPTED_TOOL_NOTE =
  "Error: cancelled — this tool call did not run because the turn was interrupted. Any tool call above it DID run; treat its result as real.";

// Close an interrupted turn WITHOUT throwing its work away.
//
// The old behavior rolled the conversation back to a pre-turn snapshot on any error or Ctrl-C. That
// kept the message list provider-valid, but it also erased tool calls that had really happened — a
// file written to disk vanished from history, so the next turn's model believed it never happened
// (see .claude/think-it-through/from-deepseek-harness-review.md). This is the honest alternative:
// keep every completed call and its result, and backfill a synthetic result for each call that never
// ran, so the assistant→tool pairing every provider requires still holds.
//
// Results are emitted in the model's ORIGINAL call order — the same guarantee runReadOnlyBatch gives
// for parallel results — so a resumed conversation reads the way the model wrote it.
export function sealInterruptedToolCalls(messages: Message[], note = INTERRUPTED_TOOL_NOTE): Message[] {
  const out: Message[] = [];
  let repaired = false;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    // A tool message belongs to the assistant group above it, and a well-formed one is consumed by
    // that group below — so reaching one HERE means it answers no call at all. Providers reject
    // that outright, so drop it. (Can't arise from a live turn; the point is that the function's
    // guarantee holds by construction rather than by luck.)
    if (m.role === "tool") {
      repaired = true;
      continue;
    }

    out.push(m);
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;

    // Consume the ENTIRE contiguous run of tool messages after this assistant — including any that
    // are malformed. Stopping early on a bad one would leave it to be re-pushed by the next outer
    // iteration, AFTER this group's results had already been emitted: the message would appear
    // twice, or land after the user message that ended the group.
    const byId = new Map<string, Message>();
    let j = i + 1;
    for (; j < messages.length && messages[j].role === "tool"; j++) {
      const id = messages[j].tool_call_id;
      if (id && !byId.has(id)) byId.set(id, messages[j]);
      else repaired = true; // no id, or a second answer to one call — either way it can't be emitted
    }
    i = j - 1; // the group is consumed; the outer loop resumes at whatever ended it

    // Exactly one result per DISTINCT call id, in the model's original call order. A repeated id in
    // one assistant message is malformed input (providers key results by id, so it could only ever
    // be answered once); emitting one result for it is the only self-consistent reading.
    const answered = new Set<string>();
    for (const call of m.tool_calls) {
      if (answered.has(call.id)) {
        repaired = true;
        continue;
      }
      answered.add(call.id);
      const answer = byId.get(call.id);
      if (answer) out.push(answer);
      else {
        out.push({ role: "tool", tool_call_id: call.id, content: note });
        repaired = true;
      }
    }
    // Anything collected that answers no call in this group is deliberately not emitted.
    for (const id of byId.keys()) if (!answered.has(id)) repaired = true;
  }

  return repaired ? out : messages;
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
      // escapes through the /resume picker label. textOf: content may be a parts array, and
      // stripControl would throw on one — inside this function's outer try, which would swallow it
      // and return [], reporting "no previous sessions" and hiding EVERY session, not just this one.
      const preview = stripControl(textOf(firstUser?.content ?? "")).replace(/\s+/g, " ").trim().slice(0, 60);
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
