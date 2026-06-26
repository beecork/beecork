// Path confinement: keep the file tools inside the project root. We canonicalize
// the resolved path — following symlinks on the part that already exists — so
// neither `..` tricks nor symlinks can point outside the tree unnoticed.

import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";

// The project root = the directory beecork was launched in. Canonicalized once.
export const projectRoot = canonical(resolve(process.cwd()));

// Resolve a user-supplied path to an absolute one and decide whether it stays
// inside the project root. `abs` is what the fs op should use; `inRoot` is the
// security verdict (false → out of bounds → the agent loop asks for approval).
export function resolveInRoot(userPath: string): { abs: string; inRoot: boolean } {
  const abs = resolve(projectRoot, userPath);
  const real = canonical(abs);
  const inRoot = real === projectRoot || real.startsWith(projectRoot + sep);
  return { abs, inRoot };
}

// Canonicalize a path even if it doesn't fully exist yet (e.g. a new file we're
// about to create): realpath the deepest EXISTING ancestor, then re-attach the
// not-yet-existing tail. realpath resolves any symlinks in the existing part.
function canonical(p: string): string {
  const parts = resolve(p).split(sep);
  for (let i = parts.length; i > 0; i--) {
    const prefix = parts.slice(0, i).join(sep) || sep;
    try {
      const real = realpathSync(prefix);
      const rest = parts.slice(i);
      return rest.length ? resolve(real, ...rest) : real;
    } catch {
      // this ancestor doesn't exist yet — try a shorter prefix
    }
  }
  return resolve(p);
}
