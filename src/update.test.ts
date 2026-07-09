// Regression tests for the update version-compare (shipped untested in the last commit).
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { isNewer, prefixFromPkgRoot } from "./update";

test("isNewer compares semver x.y.z correctly", () => {
  assert.equal(isNewer("2.2.1", "2.2.0"), true);
  assert.equal(isNewer("2.3.0", "2.2.9"), true);
  assert.equal(isNewer("3.0.0", "2.9.9"), true);
  assert.equal(isNewer("2.2.0", "2.2.0"), false); // equal
  assert.equal(isNewer("2.1.9", "2.2.0"), false); // older
  assert.equal(isNewer("2.2.0", "2.2.1"), false);
  assert.equal(isNewer("2.10.0", "2.9.0"), true); // numeric, not lexical
});

test("prefixFromPkgRoot derives the npm prefix so `beecork update` targets the running copy", () => {
  // unix global (root prefix): <prefix>/lib/node_modules/beecork
  assert.equal(prefixFromPkgRoot("/usr/local/lib/node_modules/beecork"), "/usr/local");
  // unix custom prefix (the ~/.npm-global case)
  assert.equal(prefixFromPkgRoot("/home/u/.npm-global/lib/node_modules/beecork"), "/home/u/.npm-global");
  // Windows-style layout (no intermediate lib/): <prefix>/node_modules/beecork
  assert.equal(prefixFromPkgRoot("/opt/npm/node_modules/beecork"), "/opt/npm");
  // dev: running from the repo, not a node_modules install → null (fall back to plain global install)
  assert.equal(prefixFromPkgRoot("/home/u/code/beecork"), null);
});
