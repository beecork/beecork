// The remember tool's consolidation budget (item 2b). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTool } from "./tools";
import { config } from "./config";
import type { ToolCall } from "./types";

const tc = (name: string, args: object): ToolCall => ({ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } });

test("remember: refuses over the char budget and tells the model to consolidate (file untouched)", async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "bk-mem-"));
  try {
    process.chdir(dir);
    await mkdir(join(dir, ".beecork"), { recursive: true });
    const near = "x".repeat(config.memoryMaxChars - 10); // just under the cap
    await writeFile(join(dir, ".beecork", "memory.md"), near, "utf8");
    const res = await runTool(tc("remember", { fact: "this line pushes it over the budget" }));
    assert.match(res, /budget/i);
    assert.match(res, /consolidate/i);
    assert.equal(await readFile(join(dir, ".beecork", "memory.md"), "utf8"), near); // refused → NOT appended
  } finally {
    process.chdir(cwd);
  }
});

test("remember: appends a line when under budget", async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "bk-mem-"));
  try {
    process.chdir(dir);
    const res = await runTool(tc("remember", { fact: "user prefers pnpm" }));
    assert.match(res, /Remembered: user prefers pnpm/);
    assert.match(await readFile(join(dir, ".beecork", "memory.md"), "utf8"), /- user prefers pnpm/);
  } finally {
    process.chdir(cwd);
  }
});

test("remember: rejects an empty fact", async () => {
  const cwd = process.cwd();
  const dir = await mkdtemp(join(tmpdir(), "bk-mem-"));
  try {
    process.chdir(dir);
    assert.match(await runTool(tc("remember", { fact: "   " })), /Error/);
  } finally {
    process.chdir(cwd);
  }
});
