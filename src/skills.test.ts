// Tests for skill expansion. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSkill } from "./skills";

const skill = (content: string) => ({ name: "x", content, source: "project" as const });

test("$ARGUMENTS is substituted in place", () => {
  assert.equal(expandSkill(skill("explain $ARGUMENTS now"), "the spinner"), "explain the spinner now");
});

test("$ARGUMENTS appears more than once → all replaced", () => {
  assert.equal(expandSkill(skill("$ARGUMENTS and $ARGUMENTS"), "x"), "x and x");
});

test("no $ARGUMENTS + extra → extra is appended", () => {
  assert.equal(expandSkill(skill("do it"), "extra"), "do it\n\nextra");
});

test("no $ARGUMENTS + no extra → content unchanged", () => {
  assert.equal(expandSkill(skill("do it"), ""), "do it");
});
