// Config parsing guarantees: an invalid effort falls back (never sent as-is), and a malformed
// OPENROUTER_EXTRA is ignored rather than breaking every request. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeEffort, parseExtra, parseSandboxMode } from "./config";

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

test("BEECORK_SANDBOX accepts the truthy spellings config.ts itself teaches (audit M3)", () => {
  // bool() in this file treats 1/true/yes/on as truthy, so a user hardening a run with
  // BEECORK_SANDBOX=1 reasonably expected "on" — and silently got "auto", the SOFT default, on the
  // one knob whose entire purpose is to fail closed.
  for (const v of ["on", "1", "true", "yes", "required", "ON", " on "]) assert.equal(parseSandboxMode(v), "on", v);
  for (const v of ["off", "0", "false", "no", "none", "never", "disabled"]) assert.equal(parseSandboxMode(v), "off", v);
  assert.equal(parseSandboxMode(undefined), "auto", "unset stays auto");
  assert.equal(parseSandboxMode("bogus"), "auto", "unrecognized falls back — and warns");
});
