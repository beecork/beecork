// Slash commands (input starting with "/" controls the program, not the model)
// and tab-completion.

import { writeFile, mkdir } from "node:fs/promises";
import { config } from "./config";
import { state } from "./state";
import { color, RECOMMENDED_MODELS } from "./ui";
import { estimateTokens } from "./context";
import { loadLatestSession } from "./memory";
import type { Message } from "./types";

export async function handleCommand(input: string, messages: Message[]): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ");

  if (cmd === "/model") {
    if (!arg) {
      console.log(color.cyan(`current model: ${state.model}`) + "\n");
    } else {
      state.model = arg;
      console.log(color.green(`switched to: ${state.model}`) + "\n");
    }
  } else if (cmd === "/models") {
    if (!arg) showRecommended();
    else await listModels(arg);
  } else if (cmd === "/context") {
    console.log(
      color.cyan(
        `~${estimateTokens(messages)} tokens in ${messages.length} messages (auto-compacts above ${config.maxContextTokens})`,
      ) + "\n",
    );
  } else if (cmd === "/resume") {
    const restored = await loadLatestSession();
    if (restored.length) {
      messages.push(...restored);
      console.log(color.cyan(`resumed ${restored.length} messages from your last session`) + "\n");
    } else {
      console.log(color.dim("no previous session to resume in this folder") + "\n");
    }
  } else if (cmd === "/good" || cmd === "/bad") {
    // Flywheel capture: save this conversation. A /bad one is a candidate to
    // turn into a new eval task later (you write the checker).
    const dir = cmd === "/bad" ? "eval/failures" : "eval/good";
    try {
      await mkdir(dir, { recursive: true });
      const file = `${dir}/${Date.now()}.json`;
      await writeFile(file, JSON.stringify({ rating: cmd.slice(1), model: state.model, messages }, null, 2), "utf8");
      console.log(
        color.cyan(`saved this conversation → ${file}`) +
          (cmd === "/bad" ? " (turn it into an eval task later)" : "") +
          "\n",
      );
    } catch (err) {
      console.log(color.red(`couldn't save: ${(err as Error).message}`) + "\n");
    }
  } else if (cmd === "/help") {
    console.log(
      color.cyan(
        [
          "commands:",
          "  /model            show the current model",
          "  /model <slug>     switch model (Tab completes slugs)",
          "  /models           show recommended starter models",
          "  /models <term>    search the full OpenRouter catalog",
          "  /context          show conversation size (tokens)",
          "  /resume           resume your last session in this folder",
          "  /good  /bad       rate this conversation (saves it; bad → eval/failures)",
          "  /help             show this help",
          "  exit              quit",
          "",
        ].join("\n"),
      ),
    );
  } else {
    console.log(color.red(`unknown command: ${cmd} (try /help)`) + "\n");
  }
}

function showRecommended(): void {
  console.log(color.cyan("recommended models (all support tools):") + "\n");
  for (const m of RECOMMENDED_MODELS) {
    const here = m.slug === state.model ? color.green("●") : " ";
    console.log(`  ${here} ${m.slug.padEnd(30)} ${color.dim(`${m.price.padStart(6)}/1M`)}  ${color.dim(m.note)}`);
  }
  console.log(`\nswitch:  ${color.cyan("/model <slug>")}    search all:  ${color.cyan("/models <term>")}\n`);
}

async function listModels(term: string): Promise<void> {
  try {
    const res = await fetch(config.modelsUrl);
    const all = (await res.json()).data as any[];
    const matches = all.filter((m) => m.id.includes(term.toLowerCase())).slice(0, 20);
    if (matches.length === 0) {
      console.log(color.dim(`no models match "${term}"`) + "\n");
      return;
    }
    for (const m of matches) {
      const tools = (m.supported_parameters ?? []).includes("tools") ? "🔧" : "  ";
      const price = m.pricing?.prompt != null ? `$${(parseFloat(m.pricing.prompt) * 1e6).toFixed(2)}/1M in` : "?";
      console.log(`  ${tools} ${m.id}  ${color.dim(`(${price})`)}`);
    }
    console.log("");
  } catch (err) {
    console.log(color.red(`couldn't fetch models: ${(err as Error).message}`) + "\n");
  }
}

// --- Tab-completion ---------------------------------------------------------
const COMMANDS = ["/help", "/model", "/models", "/context", "/resume", "/good", "/bad"];
export function completer(line: string): [string[], string] {
  if (line.startsWith("/model ")) {
    const all = RECOMMENDED_MODELS.map((m) => `/model ${m.slug}`);
    const hits = all.filter((c) => c.startsWith(line));
    return [hits.length ? hits : all, line];
  }
  if (line.startsWith("/")) {
    const hits = COMMANDS.filter((c) => c.startsWith(line));
    return [hits.length ? hits : COMMANDS, line];
  }
  return [[], line];
}
