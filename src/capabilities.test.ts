// Reasoning-capability gate: it must FAIL OPEN — an unknown / not-yet-loaded catalog sends
// `reasoning` (never silently downgrade thinking), and a model's variant suffix still matches its
// base. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSendReasoning, baseId, supportsVision } from "./capabilities";

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

test("supportsVision FAILS CLOSED before the catalog loads", () => {
  // The mirror image of shouldSendReasoning's fail-OPEN. An unnecessary `reasoning` field is
  // harmless; an image sent to a text-only model is a hard 400 that kills the whole turn — so
  // "unknown" must mean "don't send it".
  assert.equal(supportsVision("some/unknown-model"), false);
  assert.equal(shouldSendReasoning("some/unknown-model"), true, "reasoning still fails OPEN");
});
