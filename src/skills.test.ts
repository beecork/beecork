// Tests for skill expansion + parsing. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandSkill, parseSkill, skillsPrompt, loadSkills, getSkill, type Skill } from "./skills";
import { toolDefs } from "./tools";

const skill = (content: string): Skill => ({
  name: "x", content, description: "", modelInvocable: true, path: "/x.md", source: "project",
});

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

test("parseSkill: frontmatter description + opt-out; body is stripped", () => {
  const r = parseSkill("---\ndescription: Run the release checklist\nmodel-invocation: false\n---\nStep 1. do the thing");
  assert.equal(r.description, "Run the release checklist");
  assert.equal(r.modelInvocable, false);
  assert.equal(r.body, "Step 1. do the thing"); // frontmatter removed → clean /name expansion
});

test("parseSkill: no frontmatter → description falls back to first line, body unchanged", () => {
  const r = parseSkill("# How we write commits\nUse imperative mood.");
  assert.equal(r.description, "How we write commits"); // leading '#' stripped
  assert.equal(r.modelInvocable, true);
  assert.equal(r.body, "# How we write commits\nUse imperative mood."); // untouched (back-compat)
});

test("parseSkill: disable-model-invocation:true also hides from the model", () => {
  assert.equal(parseSkill("---\ndisable-model-invocation: true\n---\nx").modelInvocable, false);
});

test("skillsPrompt: advertises invocable skills, excludes opted-out ones, tags project", () => {
  const skills: Skill[] = [
    { name: "release", content: "", description: "Release steps", modelInvocable: true, path: "/g.md", source: "global" },
    { name: "secret", content: "", description: "hidden", modelInvocable: false, path: "/p.md", source: "project" },
    { name: "lint", content: "", description: "Lint rules", modelInvocable: true, path: "/p.md", source: "project" },
  ];
  const out = skillsPrompt(skills);
  assert.match(out, /- release — Release steps/);
  assert.match(out, /- lint \(project\) — Lint rules/);
  assert.doesNotMatch(out, /secret/); // opted out → not advertised to the model
});

test("skillsPrompt: no invocable skills → empty string (nothing injected)", () => {
  assert.equal(skillsPrompt([{ name: "x", content: "", description: "d", modelInvocable: false, path: "/x", source: "project" }]), "");
});

test("read_skill: returns the body, strips a leading slash, labels project skills, errors on unknown", async () => {
  await loadSkills(); // loads this repo's .beecork/skills (+ any global)
  const rs = toolDefs.find((t) => t.name === "read_skill")!;
  assert.match(await rs.run({ name: "no-such-skill-xyz" }), /Error: no skill/);
  assert.match(await rs.run({ name: "" }), /Error/);
  const check = getSkill("check"); // the repo ships .beecork/skills/check.md
  if (check) {
    const body = await rs.run({ name: "check" });
    assert.ok(body.endsWith(check.content), "returns the skill body");
    assert.equal(await rs.run({ name: "/check" }), body, "leading slash stripped");
    if (check.source === "project") assert.match(body, /LOWER TRUST/); // M3 trust label on repo skills
  }
});

test("bundled skills ship with beecork and load at lowest precedence", async () => {
  await loadSkills(); // reads global + project + the bundled skills/ dir
  const bs = getSkill("browser-signals"); // shipped in skills/browser-signals.md
  assert.ok(bs, "the bundled browser-signals skill loads");
  assert.equal(bs!.source, "bundled");
  assert.ok(bs!.description.length > 0, "advertises a one-line description");
});
