// The agent core: the system prompt, the permission gate, and runTurn — one
// full turn of the agentic loop (call model → run tools → feed back → repeat).

import type { createInterface } from "node:readline/promises";
import { config } from "./config";
import { state, trace } from "./state";
import { color } from "./ui";
import { callModel } from "./api";
import { compactIfNeeded } from "./context";
import { toolsByName, runTool, runVerify } from "./tools";
import type { Message, ToolCall } from "./types";

export const SYSTEM_PROMPT = `You are beecork, a coding assistant working in a terminal on the user's machine.

Environment:
- Working directory: ${process.cwd()}
- Platform: ${process.platform}

# How to work
- For multi-step tasks, call \`update_todos\` to write a short plan, then work through it — mark each item in_progress when you start it and completed when done. Keep the list current.
- Keep going until the task is FULLY complete. Don't stop after one step or hand back a half-finished task to ask what's next — unless you are genuinely blocked or need a real decision from the user.
- Work in small steps and VERIFY: after changes, run the relevant test/build/command. An automatic check may also run after each edit — if it reports FAILED, fix the problem before continuing. Read the output and fix anything that broke.
- Use your tools to find facts instead of guessing.
- When the user shares a durable preference, project convention, or fact worth keeping across sessions, call \`remember\` to save it.

# Using your tools
- Find where something is with \`search\`; see a file with \`read_file\`.
- Change an existing file with \`edit_file\` (a precise snippet replace) — always \`read_file\` it first so your edit matches exactly. Use \`write_file\` only to create NEW files.
- Prefer your dedicated tools (\`search\`, \`read_file\`, \`list_dir\`) over \`run_bash\`. Use \`run_bash\` only for things they can't do — running tests, builds, or git.

# Communication
- Be concise; use plain text. Briefly say what you're about to do before doing it. Avoid heavy markdown tables and emoji unless asked.

# Safety
- Be careful with anything that deletes or overwrites. Don't do destructive things unless the user clearly asked.`;

// Ask the user to approve a dangerous tool call. Defaults to DENY if unclear.
async function askApproval(
  rl: ReturnType<typeof createInterface>,
  call: ToolCall,
): Promise<"once" | "always" | "deny"> {
  let args: Record<string, any> = {};
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    // show raw arguments below
  }

  console.log(color.yellow(`\n⚠️  The agent wants to use: ${call.function.name}`));
  if (call.function.name === "run_bash") {
    console.log(color.yellow(`   $ ${args.command}`));
  } else if (call.function.name === "write_file") {
    console.log(color.yellow(`   write ${String(args.content ?? "").length} chars to: ${args.path}`));
  } else {
    console.log(color.yellow(`   ${call.function.arguments}`));
  }

  const answer = (await rl.question(color.yellow("   allow? [y]es / [n]o / [a]lways: "))).trim().toLowerCase();
  if (answer === "a" || answer === "always") return "always";
  if (answer === "y" || answer === "yes") return "once";
  return "deny";
}

// Run one full turn. Returns the updated conversation (or the pre-turn snapshot
// if the turn failed). The conversation may be reassigned by compaction, which
// is why this returns it rather than only mutating in place.
export async function runTurn(
  messages: Message[],
  userInput: string,
  rl: ReturnType<typeof createInterface>,
  approvedTools: Set<string>,
): Promise<Message[]> {
  const snapshot = messages.slice(); // roll back the whole turn on failure
  messages.push({ role: "user", content: userInput });

  try {
    let answered = false;
    const callCounts = new Map<string, number>(); // loop detector (per turn)

    for (let step = 0; step < config.maxSteps && !answered; step++) {
      // Keep within the window — before EACH call, so a turn can't overflow either.
      try {
        messages = await compactIfNeeded(messages);
      } catch (err) {
        console.error(color.red(`\n[compaction failed: ${(err as Error).message} — continuing]`) + "\n");
      }

      const message = await callModel(messages);
      messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const call of message.tool_calls) {
          // Loop detector: refuse an identical call repeated too many times.
          const sig = `${call.function.name}:${call.function.arguments}`;
          const seen = (callCounts.get(sig) ?? 0) + 1;
          callCounts.set(sig, seen);
          if (seen >= config.loopRepeatLimit) {
            console.log(color.yellow(`   ↳ skipped — repeated identical call ${seen}×`));
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content:
                "You have already called this exact tool with these exact arguments several times; it is not making progress. Stop repeating it — try a different approach or give your final answer.",
            });
            continue;
          }

          const tool = toolsByName.get(call.function.name);

          // Permission gate (skipped in headless AUTO_APPROVE mode).
          if (tool?.needsApproval && !approvedTools.has(call.function.name) && !config.autoApprove) {
            const decision = await askApproval(rl, call);
            if (decision === "deny") {
              console.log(color.red("   ↳ denied") + "\n");
              messages.push({
                role: "tool",
                tool_call_id: call.id,
                content: "The user DENIED permission to run this tool. Do not retry it.",
              });
              continue;
            }
            if (decision === "always") approvedTools.add(call.function.name);
          }

          const isTodo = call.function.name === "update_todos";
          console.log(
            color.dim(`🔧 ${isTodo ? "update_todos" : `${call.function.name}(${call.function.arguments})`}`),
          );
          if (config.traceFile) trace.push({ tool: call.function.name, args: call.function.arguments, step });

          let result = await runTool(call);
          // Auto-verify after a file mutation so the model sees what it broke.
          if (config.verifyCommand && (call.function.name === "write_file" || call.function.name === "edit_file")) {
            console.log(color.dim(`   auto-check: ${config.verifyCommand}`));
            result += `\n\n[auto-check: ${config.verifyCommand}]\n${await runVerify()}`;
          }
          // Cap giant outputs so one read/command can't blow the window.
          if (result.length > config.maxToolResultChars) {
            result =
              result.slice(0, config.maxToolResultChars) +
              `\n…[truncated ${result.length - config.maxToolResultChars} chars]`;
          }
          if (isTodo) {
            console.log(color.cyan(result.split("\n").map((l) => "   " + l).join("\n")));
          } else {
            console.log(color.dim(`   ↳ ${result.length} chars returned`));
          }
          messages.push({ role: "tool", tool_call_id: call.id, content: result });
        }
      } else {
        answered = true; // text was already streamed live
      }
    }

    if (!answered) {
      // Hit the step cap — don't die silently. Ask for a final wrap-up (no tools).
      console.log(color.dim(`\n[reached the ${config.maxSteps}-step limit — wrapping up]`));
      messages.push({
        role: "system",
        content: `You have reached the ${config.maxSteps}-step limit for this turn. Do not call any more tools. Briefly tell the user what you accomplished and what still remains.`,
      });
      messages.push(await callModel(messages, false));
    }

    return messages;
  } catch (err) {
    console.error(color.red(`\n[error] ${(err as Error).message}`) + "\n");
    return snapshot; // roll the whole turn back to a known-good state
  }
}
