// Fixture content used by tasks' setup() — kept here so tasks.ts stays readable.

// A check script the agent must make pass (verify-hook self-correction task).
// The expected value comes from the EXPECTED env var — NOT written in any file —
// so the agent can ONLY learn it from this script's output, which it sees via the
// auto-check hook (agent.ts appends runVerify() output to the tool result). Each
// run appends its verdict to verify-runs.log so the checker can prove the loop
// went FAILED → PASSED (i.e. the hook drove a correction).
export const VERIFY_EXPECTED = "PINEAPPLE-42";
export const VERIFY_JS = `// Auto-check fixture. Passes only when answer.txt holds the expected value.
const fs = require("fs");
const expected = process.env.EXPECTED || "";
let actual = "";
try { actual = fs.readFileSync("answer.txt", "utf8").trim(); } catch {}
const ok = actual === expected;
const verdict = ok ? "PASSED" : ("FAILED expected=" + expected + " got=" + actual);
try { fs.appendFileSync("verify-runs.log", verdict + "\\n"); } catch {}
console.log(verdict);
process.exit(ok ? 0 : 1);
`;

// A big SINGLE-LINE blob (~6KB, no newlines) sent as one user turn. It bloats the
// conversation directly so — with a low MAX_CONTEXT_TOKENS — compaction is
// GUARANTEED to fire on a later turn, regardless of which tools the model picks.
// (Must be one line: the stdin feeder sends a turn as a single readline line, so
// a newline would split it into several turns.)
export const bigLine = "reference-filler ".repeat(380); // ~6.5k chars, no newlines
