// The tool registry: each tool defined once (schema + implementation). The
// schema list sent to the model and the name→tool dispatch map are derived.

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { config } from "./config";
import { renderTodos } from "./ui";
import type { ToolCall, ToolDef, TodoItem } from "./types";

const execAsync = promisify(exec);

// The current todo list (written by the update_todos tool, rendered at startup).
export let todos: TodoItem[] = [];

export const toolDefs: ToolDef[] = [
  {
    name: "read_file",
    description:
      "Read a text file, returned WITH line numbers (for reference only). " +
      "For large files, pass offset (1-based start line) and limit (number of lines) to read a range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file." },
        offset: { type: "number", description: "1-based line to start from (optional)." },
        limit: { type: "number", description: "Max number of lines to return (optional)." },
      },
      required: ["path"],
    },
    run: async (args) => {
      try {
        const allLines = (await readFile(args.path, "utf8")).split("\n");
        const start = args.offset && args.offset > 0 ? args.offset - 1 : 0;
        const end = args.limit && args.limit > 0 ? start + args.limit : allLines.length;
        const numbered = allLines
          .slice(start, end)
          .map((line: string, i: number) => `${String(start + i + 1).padStart(5)}  ${line}`)
          .join("\n");
        const more = end < allLines.length ? `\n…(${allLines.length - end} more lines; read again with offset ${end + 1})` : "";
        return numbered ? numbered + more : "(empty file)";
      } catch (err) {
        return `Error reading file: ${(err as Error).message}`;
      }
    },
  },
  {
    name: "search",
    description:
      "Search for a regular-expression pattern across files in a directory (recursively), returning " +
      "matching 'path:line: text'. Read-only. Use this to find where a name is defined or used.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for." },
        path: { type: "string", description: "Directory to search. Defaults to the current directory." },
      },
      required: ["pattern"],
    },
    run: async (args) => {
      let regex: RegExp;
      try {
        regex = new RegExp(args.pattern);
      } catch {
        return `Error: invalid regular expression: ${args.pattern}`;
      }
      const IGNORE = new Set(["node_modules", ".git", "dist", ".next"]);
      const results: string[] = [];
      const MAX = 100;

      async function walk(dir: string): Promise<void> {
        if (results.length >= MAX) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (results.length >= MAX) return;
          if (IGNORE.has(e.name)) continue;
          const full = `${dir}/${e.name}`;
          if (e.isDirectory()) {
            await walk(full);
          } else if (e.isFile()) {
            let lines: string[];
            try {
              lines = (await readFile(full, "utf8")).split("\n");
            } catch {
              continue; // unreadable / binary
            }
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
                if (results.length >= MAX) break;
              }
            }
          }
        }
      }

      await walk(args.path ?? ".");
      if (results.length === 0) return `No matches for "${args.pattern}".`;
      return results.join("\n") + (results.length >= MAX ? `\n…(showing first ${MAX} matches)` : "");
    },
  },
  {
    name: "write_file",
    description:
      "Create a NEW file (or fully overwrite an existing one) with the given content. " +
      "To change PART of an existing file, prefer edit_file instead.",
    needsApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to write." },
        content: { type: "string", description: "The full text to write into the file." },
      },
      required: ["path", "content"],
    },
    run: async (args) => {
      try {
        await writeFile(args.path, args.content, "utf8");
        return `Wrote ${String(args.content).length} characters to ${args.path}`;
      } catch (err) {
        return `Error writing file: ${(err as Error).message}`;
      }
    },
  },
  {
    name: "edit_file",
    description:
      "Make a precise edit to an EXISTING file: replace an exact snippet (old_text) with new_text. " +
      "old_text must match the file exactly (including whitespace) and appear EXACTLY ONCE. " +
      "Use the file's RAW text — do NOT include the line-number prefixes that read_file shows. " +
      "Prefer this over write_file when changing existing files.",
    needsApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file to edit." },
        old_text: {
          type: "string",
          description:
            "The exact text to find and replace. Must match the file exactly and appear once. " +
            "Include enough surrounding lines to make it unique.",
        },
        new_text: { type: "string", description: "The text to replace old_text with." },
      },
      required: ["path", "old_text", "new_text"],
    },
    run: async (args) => {
      try {
        const original = await readFile(args.path, "utf8");
        const count = original.split(args.old_text).length - 1; // count occurrences → refuse ambiguity
        if (count === 0) {
          return `Error: old_text not found in ${args.path}. Re-read the file and copy the exact text (including whitespace/indentation).`;
        }
        if (count > 1) {
          return `Error: old_text appears ${count} times in ${args.path}. Include more surrounding context so it matches exactly once.`;
        }
        await writeFile(args.path, original.replace(args.old_text, args.new_text), "utf8");
        return `Edited ${args.path} — replaced 1 occurrence.`;
      } catch (err) {
        return `Error editing file: ${(err as Error).message}`;
      }
    },
  },
  {
    name: "list_dir",
    description:
      "List the files and folders in a directory. Use this to list or COUNT files — " +
      "do NOT shell out to run_bash/ls for that.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path. Defaults to the current directory." },
      },
      required: [],
    },
    run: async (args) => {
      try {
        const entries = await readdir(args.path ?? ".", { withFileTypes: true });
        if (entries.length === 0) return "(empty directory)";
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
      } catch (err) {
        return `Error listing directory: ${(err as Error).message}`;
      }
    },
  },
  {
    name: "run_bash",
    description: "Run a shell command and return its output. Use for things like running tests or git.",
    needsApproval: true,
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "The shell command to run." } },
      required: ["command"],
    },
    run: async (args) => {
      try {
        const { stdout, stderr } = await execAsync(args.command, { timeout: 30_000, maxBuffer: 1_000_000 });
        return (stdout || "") + (stderr ? `\n[stderr]\n${stderr}` : "") || "(no output)";
      } catch (err) {
        return `Error running command: ${(err as Error).message}`;
      }
    },
  },
  {
    name: "update_todos",
    description:
      "Write or update your TODO list to plan and track a multi-step task. Pass the FULL list every time. " +
      "Mark an item 'in_progress' when you start it and 'completed' when done. Use this for any task with several steps.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          description: "The full todo list, in order.",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "The step." },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    run: async (args) => {
      todos = (Array.isArray(args.todos) ? args.todos : []).map((t: any) => ({
        content: String(t?.content ?? ""),
        status: t?.status === "completed" || t?.status === "in_progress" ? t.status : "pending",
      }));
      return renderTodos(todos);
    },
  },
  {
    name: "remember",
    description:
      "Save a durable fact or preference to long-term memory (.beecork/memory.md) so you recall it in future sessions. " +
      "Use when the user shares a lasting preference, project convention, or fact worth keeping. One short line per memory.",
    parameters: {
      type: "object",
      properties: { fact: { type: "string", description: "The fact to remember, one short sentence." } },
      required: ["fact"],
    },
    run: async (args) => {
      try {
        const dir = join(process.cwd(), ".beecork");
        await mkdir(dir, { recursive: true });
        const file = join(dir, "memory.md");
        let existing = "";
        try {
          existing = await readFile(file, "utf8");
        } catch {
          existing = "# beecork memory\n\n";
        }
        await writeFile(file, `${existing}- ${String(args.fact).trim()}\n`, "utf8");
        return `Remembered: ${args.fact}`;
      } catch (err) {
        return `Error saving memory: ${(err as Error).message}`;
      }
    },
  },
];

// Derived: the schema list sent to the model, and the dispatch map.
export const TOOLS = toolDefs.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));
export const toolsByName = new Map(toolDefs.map((t) => [t.name, t]));

// Look up + run a tool call. Errors come back as strings so the model can react.
export async function runTool(call: ToolCall): Promise<string> {
  const tool = toolsByName.get(call.function.name);
  if (!tool) return `Error: unknown tool "${call.function.name}".`;
  let args: Record<string, any>;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    return `Error: arguments were not valid JSON: ${call.function.arguments}`;
  }
  return tool.run(args);
}

// Run the configured check command (config.verifyCommand) after a file edit.
// A non-zero exit throws, so we catch it and capture its output.
export async function runVerify(): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(config.verifyCommand, { timeout: 60_000, maxBuffer: 1_000_000 });
    const out = `${stdout}${stderr}`.trim();
    return `passed ✓${out ? `\n${out.slice(-800)}` : ""}`;
  } catch (err: any) {
    const out = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || String(err.message ?? err);
    return `FAILED ✗\n${out.slice(-1500)}`;
  }
}
