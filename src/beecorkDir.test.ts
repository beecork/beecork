// The project .beecork/ chokepoint: beecork runs inside OTHER people's repos, so what it writes there
// must not end up in their commits — and the ignore file that ensures that must not swallow the files
// they authored. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ensureProjectBeecork, projectGitignore } from "./beecorkDir";

const run = promisify(execFile);

async function inTempRepo<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "bk-ignore-"));
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return await fn(dir);
  } finally {
    process.chdir(cwd);
  }
}

test("ensureProjectBeecork writes an ignore file and never overwrites the user's", async () => {
  await inTempRepo(async (dir) => {
    await ensureProjectBeecork("sessions");
    const written = await readFile(join(dir, ".beecork", ".gitignore"), "utf8");
    assert.match(written, /^sessions\/$/m);
    assert.match(written, /^journal\/$/m);
    // NOT a bare `*` — that would make `git add .beecork/skills/x.md` fail and let `git clean -fdx`
    // delete user-authored skills. The deny-list fails OPEN so anything unknown stays visible.
    const patterns = written.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    assert.ok(!patterns.includes("*"), "a bare * would break git add on skills/ and let git clean delete them");
    assert.ok(!patterns.some((l) => l.includes("skills")), "skills/ is a committed team feature — never ignored");
    assert.ok(!patterns.some((l) => l.includes("#")), "gitignore has no trailing comments — one would silently break the pattern");

    // The user's own edits win, always.
    await writeFile(join(dir, ".beecork", ".gitignore"), "# mine\n");
    await ensureProjectBeecork("journal");
    assert.equal(await readFile(join(dir, ".beecork", ".gitignore"), "utf8"), "# mine\n");
  });
});

test("REAL git: runtime state is ignored, user-authored skills stay addable", async () => {
  await inTempRepo(async (dir) => {
    await run("git", ["init", "-q", "."], { cwd: dir });
    await ensureProjectBeecork("sessions");
    await ensureProjectBeecork("journal");
    await writeFile(join(dir, ".beecork", "sessions", "1.json"), "{}");
    await writeFile(join(dir, ".beecork", "journal", "1.jsonl"), "{}");
    await mkdir(join(dir, ".beecork", "skills"), { recursive: true });
    await writeFile(join(dir, ".beecork", "skills", "mine.md"), "# mine");

    // Assert git's OWN verdict, not the pattern text — the pattern is a proxy, this is the property.
    // (`git check-ignore` exits 1 when nothing matches, so a throw here means NOT ignored.)
    for (const p of [".beecork/sessions/1.json", ".beecork/journal/1.jsonl"]) {
      await run("git", ["check-ignore", "-q", p], { cwd: dir }); // throws if not ignored
    }
    // …and the file the user wrote is still theirs to commit.
    await run("git", ["add", ".beecork/skills/mine.md"], { cwd: dir }); // throws if ignored
    const { stdout } = await run("git", ["status", "--porcelain", ".beecork"], { cwd: dir });
    assert.doesNotMatch(stdout, /sessions|journal/, "runtime state must not appear in git status");
    assert.match(stdout, /skills\/mine\.md/, "the user's own skill must");
  });
});
