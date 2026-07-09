// Config parsing guarantees: an invalid effort falls back (never sent as-is), and a malformed
// OPENROUTER_EXTRA is ignored rather than breaking every request. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEffort, parseExtra } from "./config";

test("normalizeEffort accepts the valid levels (case/space-insensitive), rejects the rest", () => {
  for (const v of ["off", "low", "medium", "high", "max"]) assert.equal(normalizeEffort(v), v);
  assert.equal(normalizeEffort(" HIGH "), "high"); // trimmed + lowercased
  for (const bad of ["", "  ", "none", "maximum", "1", undefined, null]) assert.equal(normalizeEffort(bad), undefined);
});

test("parseExtra: valid object JSON passes through; anything else → {} (never throws)", () => {
  assert.deepEqual(parseExtra('{"temperature":0.2,"seed":7}'), { temperature: 0.2, seed: 7 });
  for (const bad of [undefined, "", "   ", "not json", "[1,2]", "42", '"str"', "null", "{bad}"]) {
    assert.deepEqual(parseExtra(bad), {}, `should be ignored: ${bad}`); // a typo can't break requests
  }
});
