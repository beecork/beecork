// Regression tests for the update version-compare (shipped untested in the last commit).
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewer } from "./update";

test("isNewer compares semver x.y.z correctly", () => {
  assert.equal(isNewer("2.2.1", "2.2.0"), true);
  assert.equal(isNewer("2.3.0", "2.2.9"), true);
  assert.equal(isNewer("3.0.0", "2.9.9"), true);
  assert.equal(isNewer("2.2.0", "2.2.0"), false); // equal
  assert.equal(isNewer("2.1.9", "2.2.0"), false); // older
  assert.equal(isNewer("2.2.0", "2.2.1"), false);
  assert.equal(isNewer("2.10.0", "2.9.0"), true); // numeric, not lexical
});
