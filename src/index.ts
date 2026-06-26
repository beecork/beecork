// beecork — a CLI coding agent. Entry point: load memory/settings, then run a
// read-eval loop where each user message becomes one agentic turn.

import { createInterface } from "node:readline/promises";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { API_KEY, config } from "./config";
import { state, trace } from "./state";
import { color, printBanner } from "./ui";
import { SYSTEM_PROMPT, runTurn } from "./agent";
import { loadInstructions, loadSettings, saveSession } from "./memory";
import { handleCommand, completer } from "./commands";
import type { Message } from "./types";

async function main() {
  if (!API_KEY) {
    console.error("Missing OPENROUTER_API_KEY. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  // Load project memory (cork.md) + settings (settings.json) from .beecork.
  const instr = await loadInstructions();
  const settings = await loadSettings();
  if (settings.model && !process.env.OPENROUTER_MODEL) state.model = String(settings.model);

  const systemContent = instr.text
    ? `${SYSTEM_PROMPT}\n\n# Project memory & conventions (from cork.md / memory.md — follow these)\n\n${instr.text}`
    : SYSTEM_PROMPT;
  let messages: Message[] = [{ role: "system", content: systemContent }];

  const approvedTools = new Set<string>();
  if (Array.isArray(settings.alwaysAllow)) for (const t of settings.alwaysAllow) approvedTools.add(String(t));

  const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
  printBanner(state.model, instr.sources.map((s) => s.replace(homedir(), "~")));

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question(color.green("you: "));
    } catch {
      break; // stdin closed (Ctrl+D / piped input ended)
    }
    if (userInput.trim() === "exit") break;

    if (userInput.startsWith("/")) {
      await handleCommand(userInput, messages);
      continue;
    }

    messages = await runTurn(messages, userInput, rl, approvedTools);
  }

  if (messages.length > 1 && !config.traceFile) await saveSession(messages.slice(1));
  rl.close();
  if (config.traceFile) await writeFile(config.traceFile, JSON.stringify(trace), "utf8");
  console.log(color.dim("bye!"));
}

main();
