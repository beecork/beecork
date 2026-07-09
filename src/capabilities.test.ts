// Reasoning-capability gate: it must FAIL OPEN — an unknown / not-yet-loaded catalog sends
// `reasoning` (never silently downgrade thinking), and a model's variant suffix still matches its
// base. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSendReasoning, baseId } from "./capabilities";

test("shouldSendReasoning fails OPEN before the catalog loads (unknown → send it)", () => {
  // The catalog fetch is lazy/async; in a sync test it hasn't resolved, so every model is "unknown".
  assert.equal(shouldSendReasoning("deepseek/deepseek-v4-flash"), true);
  assert.equal(shouldSendReasoning("some/never-heard-of-model:free"), true);
});

test("baseId strips an OpenRouter variant suffix so a variant matches its base capabilities", () => {
  assert.equal(baseId("z-ai/glm-5.2:free"), "z-ai/glm-5.2");
  assert.equal(baseId("openai/gpt-5.5:nitro"), "openai/gpt-5.5");
  assert.equal(baseId("deepseek/deepseek-v4-flash"), "deepseek/deepseek-v4-flash"); // no suffix → unchanged
});
