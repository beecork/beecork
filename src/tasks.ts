// Background shell tasks: run a long-lived command (dev server, watcher, build) WITHOUT blocking the
// turn. `run_bash` with background:true hands off here; check_task/stop_task read + kill. Tasks persist
// ACROSS turns within a session (so a dev server you started stays up) and are ALL killed on process
// exit — a detached child we stop awaiting would otherwise SURVIVE us (a detached group leader is not
// reaped with its parent). Reuses runShell's detached-spawn + process-group-kill idiom (tools.ts:26-68).

import { spawn, type ChildProcess } from "node:child_process";
import { config } from "./config";

type BgTask = {
  id: string;
  command: string;
  child: ChildProcess;
  buffer: string; // rolling TAIL buffer — keeps the last config.backgroundTailChars, drops oldest
  totalLen: number; // total chars ever produced (for the since-last-check cursor)
  readLen: number; // totalLen at the previous check_task
  status: "running" | "exited";
  exitCode: number | null;
  startedAt: number;
};

const tasks = new Map<string, BgTask>();
let counter = 0;
const unix = process.platform !== "win32";

// --- pure helpers (unit-tested; no spawning) --------------------------------

// Append to a rolling tail buffer capped at `cap`: keep the LAST cap chars (a dev server runs for
// hours — we must not grow unbounded like runShell's freeze-at-cap). Reports whether output was dropped.
export function appendTail(buffer: string, chunk: string, cap: number): { buffer: string; dropped: boolean } {
  const combined = buffer + chunk;
  if (combined.length <= cap) return { buffer: combined, dropped: false };
  return { buffer: combined.slice(combined.length - cap), dropped: true };
}

// Output produced since the last check: the last (totalLen - readLen) chars still retained in the tail
// buffer. `dropped` = more new output was produced than the tail could hold (some new output is gone).
export function readSince(buffer: string, totalLen: number, readLen: number): { output: string; dropped: boolean } {
  const fresh = totalLen - readLen;
  if (fresh <= 0) return { output: "", dropped: false };
  if (fresh >= buffer.length) return { output: buffer, dropped: fresh > buffer.length };
  return { output: buffer.slice(buffer.length - fresh), dropped: false };
}

// --- process group kill (same idiom as runShell) ----------------------------

function killTask(task: BgTask): void {
  try {
    if (unix && task.child.pid) process.kill(-task.child.pid, "SIGKILL"); // whole group (detached leader)
    else task.child.kill("SIGKILL");
  } catch {
    try { task.child.kill("SIGKILL"); } catch { /* already gone */ }
  }
}

// --- public API (used by the run_bash background branch + check_task/stop_task) ---

// Spawn a detached background command; return its id immediately (does NOT await). Enforces the
// per-session cap. On failure returns { error } (the caller prefixes "Error:").
export function startTask(command: string): { id?: string; error?: string } {
  const running = [...tasks.values()].filter((t) => t.status === "running").length;
  if (running >= config.maxBackgroundTasks) {
    return { error: `too many background tasks (${running}/${config.maxBackgroundTasks}) — stop one with stop_task first.` };
  }
  const child = spawn(command, { shell: true, detached: unix, stdio: ["ignore", "pipe", "pipe"] });
  const id = `bg_${++counter}`;
  const task: BgTask = { id, command, child, buffer: "", totalLen: 0, readLen: 0, status: "running", exitCode: null, startedAt: Date.now() };
  const onData = (d: Buffer) => {
    const chunk = d.toString();
    task.totalLen += chunk.length;
    task.buffer = appendTail(task.buffer, chunk, config.backgroundTailChars).buffer;
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("exit", (code) => { task.status = "exited"; task.exitCode = code; });
  child.on("error", () => { task.status = "exited"; task.exitCode = task.exitCode ?? -1; });
  tasks.set(id, task);
  return { id };
}

// Read status + output produced since the last check (token-economical — no re-sending the whole log).
export function checkTask(id: string): string {
  const task = tasks.get(id);
  if (!task) return `Error: no background task with id "${id}". (Ids look like bg_1.)`;
  const { output, dropped } = readSince(task.buffer, task.totalLen, task.readLen);
  task.readLen = task.totalLen;
  const header = task.status === "running"
    ? `Task ${id} is running (${task.command}).`
    : `Task ${id} has exited (code ${task.exitCode ?? "unknown"}): ${task.command}`;
  const body = output ? `${dropped ? "…[earlier output dropped]\n" : ""}${output}` : "(no new output since last check)";
  return `${header}\n${body}`;
}

// Kill a running task's process group. Idempotent-ish: an already-exited task reports so.
export function stopTask(id: string): string {
  const task = tasks.get(id);
  if (!task) return `Error: no background task with id "${id}". (Ids look like bg_1.)`;
  if (task.status === "exited") return `Task ${id} had already exited (code ${task.exitCode ?? "unknown"}).`;
  killTask(task);
  task.status = "exited";
  return `Stopped background task ${id}.`;
}

// How many tasks are still running (for the status line).
export function runningTaskCount(): number {
  return [...tasks.values()].filter((t) => t.status === "running").length;
}

// SYNCHRONOUS kill-all, safe to call from a process 'exit' handler (process.kill is sync, unlike the
// async session save). Called on every exit path so a detached task never outlives beecork. Idempotent.
export function killAllTasks(): void {
  for (const task of tasks.values()) {
    if (task.status === "running") { killTask(task); task.status = "exited"; }
  }
}
