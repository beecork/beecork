// Per-project site binding: which browser origin(s) THIS folder's signals come from, so
// read_dev_signals scopes the shared inbox to the project you're in instead of showing every
// watched site's signals mixed together. Stored in <cwd>/.beecork/skeleton.json.
//
// This is a low-trust convenience hint, NOT a security boundary: it only narrows what the model
// SEES. It can't grant capture of a site the user hasn't paired — the extension still gates that.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

type SkeletonConfig = { origins?: string[] };
const dir = () => join(process.cwd(), ".beecork");
const file = () => join(dir(), "skeleton.json");

// Normalize any URL / bare host:port to its origin (scheme+host+port). "" if unparseable.
// Note: `new URL("localhost:8000")` does NOT throw — it reads "localhost:" as a scheme and yields
// origin "null" — so we only trust an existing http(s) scheme and otherwise prepend http://.
export function toOrigin(input: string): string {
  const s = String(input || "").trim();
  if (!s) return "";
  const withScheme = /^https?:\/\//i.test(s) ? s : "http://" + s;
  try {
    const o = new URL(withScheme).origin;
    return o === "null" ? "" : o;
  } catch {
    return "";
  }
}

// The origins this project is bound to (deduped, normalized). Empty when unset.
export async function loadProjectOrigins(): Promise<string[]> {
  try {
    const cfg = JSON.parse(await readFile(file(), "utf8")) as SkeletonConfig;
    if (!Array.isArray(cfg.origins)) return [];
    return [...new Set(cfg.origins.map(toOrigin).filter(Boolean))];
  } catch {
    return []; // no file / bad JSON → unbound
  }
}

// Remember an origin for this project (idempotent). Returns true if it was newly added.
export async function addProjectOrigin(origin: string): Promise<boolean> {
  const o = toOrigin(origin);
  if (!o) return false;
  const cur = await loadProjectOrigins();
  if (cur.includes(o)) return false;
  await mkdir(dir(), { recursive: true });
  await writeFile(file(), JSON.stringify({ origins: [...cur, o] }, null, 2) + "\n");
  return true;
}
