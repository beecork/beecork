// Slash commands (input starting with "/" controls the program, not the model),
// tab-completion data, and the menu metadata used by the live slash menu.

import { writeFile, mkdir, chmod } from "node:fs/promises";
import { config, RECOMMENDED_MODELS } from "./config";
import { state } from "./state";
import { color, stripControl } from "./ui";
import { estimateTokens } from "./context";
import { loadLatestSession, listSessions, loadSession, saveUserConfig, saveModelPreference } from "./memory";
import { skillNames } from "./skills";
import { selfUpdate } from "./update";
import { selectMenu } from "./input";
import type { Message } from "./types";

// Single source of truth: name + one-line description (shown in the live menu).
export const SLASH_COMMANDS: { name: string; desc: string }[] = [
  { name: "/model", desc: "switch model (menu; /model <term> searches)" },
  { name: "/context", desc: "conversation size in tokens" },
  { name: "/clear", desc: "clear the conversation" },
  { name: "/key", desc: "set + save your OpenRouter API key" },
  { name: "/update", desc: "update beecork to the latest version" },
  { name: "/resume", desc: "resume a previous session (pick from a list)" },
  { name: "/good", desc: "rate this conversation good" },
  { name: "/bad", desc: "rate this conversation bad (→ eval/failures)" },
  { name: "/help", desc: "show this help" },
];
const COMMANDS = SLASH_COMMANDS.map((c) => c.name);

// Set + persist the active model so the choice sticks across restarts (like /key). Returns the slug.
function applyModel(slug: string): string {
  state.model = slug;
  void saveModelPreference(slug);
  return slug;
}

// Short relative time ("3m ago") for the /resume session picker.
function ago(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (!ms || s < 0) return "unknown";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Print a restored conversation so the user can SEE what /resume loaded (tool calls/results
// are omitted to keep it readable — the model still gets the full restored history).
function replayConversation(msgs: Message[]): void {
  console.log(color.dim("┄┄┄ resumed conversation ┄┄┄") + "\n");
  for (const m of msgs) {
    // stripControl: a project session file is repo-controlled — it must not carry escapes.
    const c = typeof m.content === "string" ? stripControl(m.content).trim() : "";
    if (m.role === "user" && c) console.log(color.green("you: ") + c + "\n");
    else if (m.role === "assistant" && c) console.log(color.cyan("bee: ") + c + "\n");
  }
}

export async function handleCommand(input: string, messages: Message[]): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ");

  if (cmd === "/model") {
    if (!arg) await pickModel();
    else if (arg.includes("/")) {
      applyModel(arg); // looks like a full slug (vendor/name) — set it directly (and persist)
      console.log(color.green(`switched to: ${state.model}`) + "\n");
    } else {
      await searchModels(arg); // a bare term — search the catalog
    }
  } else if (cmd === "/key") {
    if (!arg) {
      console.log(color.dim("usage: /key <your-openrouter-key>  (saved to ~/.beecork/config.json)") + "\n");
    } else {
      state.apiKey = arg;
      await saveUserConfig({ OPENROUTER_API_KEY: arg });
      console.log(color.green("API key updated and saved.") + "\n");
    }
  } else if (cmd === "/context") {
    console.log(
      color.cyan(
        `~${estimateTokens(messages)} tokens in ${messages.length} messages (auto-compacts above ${config.maxContextTokens})`,
      ) + "\n",
    );
  } else if (cmd === "/update") {
    console.log(color.dim("updating beecork… (npm install -g beecork@latest)"));
    const { ok, output } = await selfUpdate();
    if (ok) console.log(color.green("✓ updated — restart beecork to use the new version.") + "\n");
    else {
      console.log(color.red("update failed: ") + output.split("\n").filter(Boolean).slice(-1)[0]);
      console.log(color.dim("  run manually: npm install -g beecork  (may need sudo / your version manager)") + "\n");
    }
  } else if (cmd === "/clear") {
    messages.splice(1); // keep the system prompt; drop the conversation history
    if (process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // clear screen + scrollback + home
    console.log(color.dim("conversation cleared (kept the system prompt, your model + settings).") + "\n");
  } else if (cmd === "/resume") {
    const sessions = process.stdin.isTTY ? await listSessions() : [];
    let restored: Message[] = [];
    if (sessions.length > 1) {
      // Pick which session to resume.
      const choice = await selectMenu({
        title: "resume which session? — ↑/↓ then Enter (Esc to cancel)",
        items: sessions.map((s) => ({
          label: s.preview || "(no first message)",
          value: s.file,
          hint: `${s.count} msg${s.count === 1 ? "" : "s"} · ${ago(s.when)}`,
        })),
      });
      if (!choice) {
        console.log(color.dim("resume cancelled") + "\n");
        return;
      }
      restored = await loadSession(choice);
    } else {
      restored = await loadLatestSession();
    }
    if (!restored.length) {
      console.log(color.dim("no previous session to resume in this folder") + "\n");
      return;
    }
    messages.splice(1, messages.length, ...restored); // replace conversation (keep system prompt); idempotent
    replayConversation(restored); // print it so you can SEE what loaded (and confirm the bee has it)
    console.log(color.green(`↑ resumed ${restored.length} messages — the bee has this context now. Continue below.`) + "\n");
  } else if (cmd === "/good" || cmd === "/bad") {
    // Flywheel capture: save this conversation. A /bad one is a candidate to
    // turn into a new eval task later (you write the checker).
    const dir = cmd === "/bad" ? "eval/failures" : "eval/good";
    try {
      await mkdir(dir, { recursive: true });
      const file = `${dir}/${Date.now()}.json`;
      await writeFile(file, JSON.stringify({ rating: cmd.slice(1), model: state.model, messages }, null, 2), "utf8");
      await chmod(file, 0o600).catch(() => {}); // the transcript may contain file contents / command output
      console.log(
        color.cyan(`saved this conversation → ${file}`) +
          (cmd === "/bad" ? " (turn it into an eval task later)" : "") +
          "\n",
      );
    } catch (err) {
      console.log(color.red(`couldn't save: ${(err as Error).message}`) + "\n");
    }
  } else if (cmd === "/help") {
    // Generated from SLASH_COMMANDS (the single source of truth the live menu also uses) so
    // /help can't drift out of sync, plus the non-command extras (skills, keys) below.
    const lines = [
      "commands (type / to open the menu):",
      ...SLASH_COMMANDS.map((c) => `  ${c.name.padEnd(16)}  ${c.desc}`),
      `  ${"/<name>".padEnd(16)}  run a skill from .beecork/skills/<name>.md`,
      `  ${"Shift+Tab".padEnd(16)}  rotate mode: normal → auto-approve → read-only`,
      `  ${"exit".padEnd(16)}  quit`,
      "",
    ];
    console.log(color.cyan(lines.join("\n")));
  } else {
    console.log(color.red(`unknown command: ${cmd} (try /help)`) + "\n");
  }
}

// /model with no arg: an arrow-key picker over the recommended models (TTY); a
// plain printed list otherwise.
async function pickModel(): Promise<void> {
  if (!process.stdin.isTTY) return showRecommended();
  const choice = await selectMenu({
    title: "switch model — ↑/↓ then Enter (Esc to cancel)",
    initial: Math.max(0, RECOMMENDED_MODELS.findIndex((m) => m.slug === state.model)),
    items: RECOMMENDED_MODELS.map((m) => ({
      label: (m.slug === state.model ? "● " : "  ") + m.slug,
      value: m.slug,
      hint: `${m.price}/1M · ${m.note}`,
    })),
  });
  if (choice) console.log(color.green(`switched to: ${applyModel(choice)}`) + "\n");
}

function showRecommended(): void {
  console.log(color.cyan("recommended models (all support tools):") + "\n");
  for (const m of RECOMMENDED_MODELS) {
    const here = m.slug === state.model ? color.green("●") : " ";
    console.log(`  ${here} ${m.slug.padEnd(30)} ${color.dim(`${m.price.padStart(6)}/1M`)}  ${color.dim(m.note)}`);
  }
  console.log(`\nswitch:  ${color.cyan("/model")}  (menu)    search all:  ${color.cyan("/model <term>")}\n`);
}

type OpenRouterModel = { id: string; supported_parameters?: string[]; pricing?: { prompt?: string } };

// /model <term>: search the full OpenRouter catalog; pick from a menu (TTY) or print.
async function searchModels(term: string): Promise<void> {
  try {
    const res = await fetch(config.modelsUrl, { signal: AbortSignal.timeout(config.webTimeoutMs) }); // don't hang forever
    const all = ((await res.json()) as { data?: OpenRouterModel[] }).data ?? [];
    const matches = all.filter((m) => m.id.includes(term.toLowerCase())).slice(0, 30);
    if (matches.length === 0) {
      console.log(color.dim(`no models match "${term}"`) + "\n");
      return;
    }
    const priceOf = (m: OpenRouterModel) =>
      m.pricing?.prompt != null ? `$${(parseFloat(m.pricing.prompt) * 1e6).toFixed(2)}/1M` : "?";
    if (process.stdin.isTTY) {
      const choice = await selectMenu({
        title: `models matching "${term}" — ↑/↓ then Enter (Esc to cancel)`,
        items: matches.map((m) => ({
          label: m.id,
          value: m.id,
          hint: ((m.supported_parameters ?? []).includes("tools") ? "tools · " : "") + priceOf(m),
        })),
      });
      if (choice) console.log(color.green(`switched to: ${applyModel(choice)}`) + "\n");
    } else {
      for (const m of matches) {
        const tools = (m.supported_parameters ?? []).includes("tools") ? "🔧" : "  ";
        console.log(`  ${tools} ${m.id}  ${color.dim(`(${priceOf(m)})`)}`);
      }
      console.log("");
    }
  } catch (err) {
    console.log(color.red(`couldn't fetch models: ${(err as Error).message}`) + "\n");
  }
}

// --- Tab-completion (non-TTY readline fallback only) ------------------------
// Is this a built-in command? (Built-ins always win over a same-named skill.)
export function isBuiltin(cmd: string): boolean {
  return COMMANDS.includes(cmd.startsWith("/") ? cmd : "/" + cmd);
}

export function completer(line: string): [string[], string] {
  if (line.startsWith("/model ")) {
    const all = RECOMMENDED_MODELS.map((m) => `/model ${m.slug}`);
    const hits = all.filter((c) => c.startsWith(line));
    return [hits.length ? hits : all, line];
  }
  if (line.startsWith("/")) {
    const all = [...COMMANDS, ...skillNames().map((n) => "/" + n)]; // built-ins + user skills
    const hits = all.filter((c) => c.startsWith(line));
    return [hits.length ? hits : all, line];
  }
  return [[], line];
}
