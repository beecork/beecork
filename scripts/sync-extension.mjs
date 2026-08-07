// Refresh the vendored copy of the Beecork Skeleton extension from its own repo.
//
// WHY A VENDORED COPY: the extension is a SEPARATE git repo, but beecork must ship it so that
// `beecork skeleton` can hand the user a folder that actually exists on their machine. Without it,
// an npm user is told to "Load unpacked -> select beecork-extension/extension" — a path only the
// author has, which made the whole browser-signals feature uninstallable.
//
// WHY COMMITTED, NOT GENERATED AT PUBLISH TIME: .github/workflows/publish.yml runs `npm ci` on THIS
// repo alone. The sibling checkout does not exist there, so a prepublishOnly copy would fail in CI.
// So extension/ is committed like skills/ and skeleton/ already are, and this script is run BY HAND
// before a release. Run:  npm run sync:extension
//
// No dependencies — Node built-ins only, matching the extension repo's own scripts/package.mjs.

import { cp, rm, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "extension");
const src = join(root, "..", "beecork-extension", "extension");

if (!existsSync(src)) {
  console.error(`sync-extension: source not found at ${src}`);
  console.error(`The extension lives in its own repo. Clone it next to this one:`);
  console.error(`  git clone <beecork-extension> ${join(root, "..", "beecork-extension")}`);
  process.exit(1);
}

// Dev-only files that must never ship: tests and OS cruft. Mirrors the exclusions in the extension
// repo's scripts/package.mjs, so the vendored copy matches what the store zip contains.
const skip = (p) => /(?:^|[\\/])(?:\.DS_Store|.*\.test\.mjs)$/.test(p);

await rm(dest, { recursive: true, force: true }); // full replace — a stale file here ships to users
await cp(src, dest, { recursive: true, filter: (p) => !skip(p) });

const { version, name } = JSON.parse(await readFile(join(dest, "manifest.json"), "utf8"));
const files = (await readdir(dest, { recursive: true })).filter((f) => !f.includes("/") || f.startsWith("icons/"));
console.log(`synced ${name} v${version} -> extension/ (${files.length} files)`);
console.log(`remember to commit it — publish CI cannot reach the sibling repo.`);
