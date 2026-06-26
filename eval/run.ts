// A tiny EVAL harness (Part 14).
//
// For each task: make a clean temp dir, run our agent on the prompt (headless),
// then run a DETERMINISTIC checker to decide pass/fail. Print a success rate.
// This is how you measure — objectively — whether a change to the agent helped.

import { spawn, exec } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execAsync = promisify(exec);

// Load the API key from the project .env so spawned agents inherit it.
try {
  process.loadEnvFile(".env");
} catch {
  // key may already be in the environment
}

const TSX = join(process.cwd(), "node_modules/.bin/tsx");
const ENTRY = join(process.cwd(), "src/index.ts");

type ToolCall = { tool: string; args: string; step: number };
type Task = {
  name: string;
  prompt: string;
  setup?: (dir: string) => Promise<void>; // create starting files
  // objective pass/fail — gets the files (dir), what it printed (output), and
  // the trace of tool calls (how it worked).
  check: (dir: string, output: string, trace: ToolCall[]) => Promise<boolean>;
  // generous efficiency budget. Going over is reported (⚠️), NOT a failure —
  // because LLM paths vary run-to-run, a hard step limit would be flaky.
  maxCalls?: number;
};

// --- checker helpers --------------------------------------------------------
const usedTool = (trace: ToolCall[], name: string) => trace.some((t) => t.tool === name);

// LLM-as-judge: ask the model PASS/FAIL on a subjective criterion. NOISY — use
// only when a code-check can't express the criterion, and gate it behind a
// cheap code-check where possible.
async function judge(criterion: string, content: string): Promise<boolean> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash",
      messages: [
        { role: "system", content: "You are a strict grader. Reply with ONLY the word PASS or FAIL." },
        { role: "user", content: `Criterion: ${criterion}\n\n--- content ---\n${content}\n--- end ---\n\nDoes the content meet the criterion?` },
      ],
    }),
  });
  const verdict = ((await res.json()).choices?.[0]?.message?.content ?? "").toUpperCase();
  return verdict.includes("PASS");
}

const TASKS: Task[] = [
  {
    name: "create a file with exact content",
    prompt: "Create a file named hello.txt containing exactly this text: hello world",
    maxCalls: 3,
    check: async (dir) => {
      try {
        return (await readFile(join(dir, "hello.txt"), "utf8")).trim() === "hello world";
      } catch {
        return false;
      }
    },
  },
  {
    name: "edit a value in an existing file",
    prompt: "In config.txt, change the port from 3000 to 8080. Keep everything else the same.",
    maxCalls: 5,
    setup: async (dir) => writeFile(join(dir, "config.txt"), "host=localhost\nport=3000\ndebug=false\n"),
    check: async (dir, _output, trace) => {
      try {
        const c = await readFile(join(dir, "config.txt"), "utf8");
        const correct = c.includes("8080") && !c.includes("3000") && c.includes("host=localhost");
        // PATH quality: must use precise edit_file, never clobber with write_file.
        return correct && usedTool(trace, "edit_file") && !usedTool(trace, "write_file");
      } catch {
        return false;
      }
    },
  },
  {
    name: "count the .txt files (read-only)",
    prompt: "How many files ending in .txt are in this directory? Reply with just the number.",
    maxCalls: 3,
    setup: async (dir) => {
      for (const f of ["a.txt", "b.txt", "c.txt", "notes.md"]) await writeFile(join(dir, f), "x");
    },
    // PATH quality: should use the dedicated list_dir, not shell out to run_bash.
    check: async (_dir, output, trace) =>
      /\b3\b/.test(output) && usedTool(trace, "list_dir") && !usedTool(trace, "run_bash"),
  },
  {
    name: "create two files (multi-step)",
    prompt: "Create two files: one.txt containing 1, and two.txt containing 2.",
    maxCalls: 4,
    check: async (dir) => {
      try {
        const a = (await readFile(join(dir, "one.txt"), "utf8")).trim();
        const b = (await readFile(join(dir, "two.txt"), "utf8")).trim();
        return a === "1" && b === "2";
      } catch {
        return false;
      }
    },
  },
  {
    name: "write a friendly description (LLM-judged)",
    prompt: "Create a file about.txt with a friendly 2-3 sentence description of a to-do list app.",
    maxCalls: 3,
    check: async (dir) => {
      try {
        const content = await readFile(join(dir, "about.txt"), "utf8");
        if (content.trim().length < 20) return false; // cheap code-check FIRST
        return await judge("A friendly, clear 2-3 sentence description of a to-do list app.", content);
      } catch {
        return false;
      }
    },
  },

  // --- added coverage: search, ranged read, error handling, run+report ------
  {
    name: "find which file contains a string (search)",
    prompt: "Which file in this directory contains the text 'function greet'? Reply with just the filename.",
    maxCalls: 4,
    setup: async (dir) => {
      await writeFile(join(dir, "util.txt"), "some helpers\nfunction greet() { return 'hi' }\n");
      await writeFile(join(dir, "other.txt"), "nothing relevant here\n");
      await writeFile(join(dir, "readme.txt"), "a project\n");
    },
    check: async (_dir, output, trace) => /util\.txt/.test(output) && usedTool(trace, "search"),
  },
  {
    name: "read a specific line range",
    prompt: "What is the text on line 7 of lines.txt? Reply with just that line's text.",
    maxCalls: 3,
    setup: async (dir) =>
      writeFile(
        join(dir, "lines.txt"),
        Array.from({ length: 10 }, (_, i) => (i === 6 ? "SEVENTH" : `line ${i + 1}`)).join("\n"),
      ),
    check: async (_dir, output) => /SEVENTH/.test(output),
  },
  {
    name: "handle a missing file gracefully",
    prompt: "Read the file does-not-exist.txt and tell me what happened.",
    maxCalls: 3,
    check: async (_dir, output) => /no such|not exist|n['o]t exist|enoent|missing|couldn|error|not found/i.test(output),
  },
  {
    name: "run a command and report its output",
    prompt: "Run the command: echo BEECORK_OK_123 — then tell me exactly what it printed.",
    maxCalls: 3,
    check: async (_dir, output, trace) => /BEECORK_OK_123/.test(output) && usedTool(trace, "run_bash"),
  },

  // --- harder coverage: debug loop, multi-file, memory, ambiguity -----------
  {
    name: "fix a bug so the test passes (debug loop)",
    prompt: "Running `node test.js` fails because of a bug in add.js. Read the files, fix the bug in add.js, and make the test pass.",
    maxCalls: 8,
    setup: async (dir) => {
      await writeFile(join(dir, "add.js"), "module.exports = function add(a, b) {\n  return a - b; // bug: should add\n};\n");
      await writeFile(join(dir, "test.js"), 'const add = require("./add");\nif (add(2, 3) !== 5) { console.error("FAIL"); process.exit(1); }\nconsole.log("PASS");\n');
    },
    check: async (dir) => {
      try {
        await execAsync("node test.js", { cwd: dir, timeout: 10_000 }); // exit 0 = test passes
        return true;
      } catch {
        return false;
      }
    },
  },
  {
    name: "rename a symbol across multiple files",
    prompt: "Rename every occurrence of 'oldName' to 'newName' across all files in this directory.",
    maxCalls: 10,
    setup: async (dir) => {
      await writeFile(join(dir, "a.txt"), "const oldName = 1;\nuse(oldName);\n");
      await writeFile(join(dir, "b.txt"), "// references oldName here\nexport { oldName };\n");
    },
    check: async (dir) => {
      try {
        const a = await readFile(join(dir, "a.txt"), "utf8");
        const b = await readFile(join(dir, "b.txt"), "utf8");
        return a.includes("newName") && b.includes("newName") && !a.includes("oldName") && !b.includes("oldName");
      } catch {
        return false;
      }
    },
  },
  {
    name: "follow a cork.md convention",
    prompt: "Create a file note.txt containing a short friendly greeting.",
    maxCalls: 3,
    setup: async (dir) =>
      writeFile(
        join(dir, "cork.md"),
        "# Conventions\n- IMPORTANT: every text file you create must begin with the exact first line: GENERATED-BY-BEECORK\n",
      ),
    check: async (dir) => {
      try {
        return (await readFile(join(dir, "note.txt"), "utf8")).startsWith("GENERATED-BY-BEECORK");
      } catch {
        return false;
      }
    },
  },
  {
    name: "save a preference to memory (remember)",
    prompt: "Please remember that I prefer 2-space indentation.",
    maxCalls: 3,
    check: async (dir) => {
      try {
        return /2.?space|indent/i.test(await readFile(join(dir, ".beecork", "memory.md"), "utf8"));
      } catch {
        return false;
      }
    },
  },
  {
    name: "edit the right one of two similar lines (ambiguity)",
    prompt: "In cfg.txt, change the timeout to 60. Leave retries unchanged.",
    maxCalls: 5,
    setup: async (dir) => writeFile(join(dir, "cfg.txt"), "timeout = 30\nretries = 30\n"),
    check: async (dir) => {
      try {
        const c = await readFile(join(dir, "cfg.txt"), "utf8");
        return c.includes("timeout = 60") && c.includes("retries = 30");
      } catch {
        return false;
      }
    },
  },
];

// Run the agent headless in `dir` with `prompt`. Returns what it printed AND
// the trace of tool calls it made (read from the TRACE_FILE it writes on exit).
function runAgent(dir: string, prompt: string): Promise<{ output: string; trace: ToolCall[] }> {
  const tracePath = dir + ".trace.json"; // sibling file, not inside the task dir
  return new Promise((resolve) => {
    const child = spawn(TSX, [ENTRY], {
      cwd: dir,
      env: { ...process.env, AUTO_APPROVE: "1", NO_COLOR: "1", TRACE_FILE: tracePath },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", async () => {
      let trace: ToolCall[] = [];
      try {
        trace = JSON.parse(await readFile(tracePath, "utf8"));
      } catch {
        // no trace (agent made no tool calls, or errored) — leave it empty
      }
      await rm(tracePath, { force: true });
      resolve({ output: out, trace });
    });
    child.stdin.write(prompt + "\nexit\n");
    child.stdin.end();
  });
}

async function main() {
  let passed = 0;
  let totalCalls = 0;
  let overBudget = 0;
  for (const task of TASKS) {
    const dir = await mkdtemp(join(tmpdir(), "agenteval-"));
    if (task.setup) await task.setup(dir);
    const { output, trace } = await runAgent(dir, task.prompt);
    const ok = await task.check(dir, output, trace).catch(() => false);
    await rm(dir, { recursive: true, force: true });

    totalCalls += trace.length;
    const over = task.maxCalls != null && trace.length > task.maxCalls;
    if (over) overBudget++;
    const path = trace.length ? trace.map((t) => t.tool).join(" → ") : "(no tools)";
    console.log(`${ok ? "PASS ✓" : "FAIL ✗"}  ${task.name}`);
    console.log(`         path: ${path}  (${trace.length} calls${over ? `, ⚠️ over budget of ${task.maxCalls}` : ""})`);
    if (ok) passed++;
  }
  // Correctness and efficiency are reported separately — efficiency never
  // changes the pass/fail score (LLM step counts vary too much for that).
  const pct = Math.round((passed / TASKS.length) * 100);
  const avg = (totalCalls / TASKS.length).toFixed(1);
  console.log(`\nScore:      ${passed}/${TASKS.length}  (${pct}%)`);
  console.log(`Efficiency: ${avg} tool calls/task avg · ${overBudget} task(s) over budget`);
}

main();
