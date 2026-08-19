// User-attached images: "look at this @shot.png".
//
// The parse runs AFTER submit, as a pure string→(text, refs) function. That is deliberate and it is
// what keeps BOTH line editors (input.ts and chrome.ts) at a zero-line diff — neither needs to know
// this feature exists. The cost is no live highlighting of @refs while typing, which is a fair trade
// for not touching two hand-written editors.

import { readFile, stat } from "node:fs/promises";
import { resolveInRoot } from "./paths";
import { config } from "./config";
import { sniffImage, imagePart } from "./images";
import type { ImagePart } from "./types";

// Only these extensions turn an @token into an attachment. This is the load-bearing disambiguation:
// "@types/node", "@user", and "@src/index.ts" must survive VERBATIM in the text the model sees.
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

// @"quoted path with spaces" or @unquoted-token
const REF = /@(?:"([^"]+)"|'([^']+)'|([^\s"']+))/g;

// A line that is ONLY a path — what a macOS terminal produces when you drag a file in. It arrives
// quoted or backslash-escaped, never as an @ref, so it needs its own shape.
function dropPath(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  const quoted = /^'(.+)'$/.exec(t) ?? /^"(.+)"$/.exec(t);
  const path = quoted ? quoted[1] : t.replace(/\\(.)/g, "$1"); // unescape "Screen\ Shot.png"
  if (!quoted && /\s/.test(t) && !/\\ /.test(t)) return null; // unquoted with real spaces → prose, not a path
  return IMAGE_EXT.test(path) ? path : null;
}

// PURE. Split a submitted line into the text the model sees + the image paths to attach.
export function extractAttachments(line: string): { text: string; refs: string[] } {
  const drop = dropPath(line);
  if (drop) return { text: "", refs: [drop] };

  const refs: string[] = [];
  const text = line.replace(REF, (whole, dq, sq, bare) => {
    const path = dq ?? sq ?? bare;
    if (!IMAGE_EXT.test(path)) return whole; // @types/node, @user, @src/index.ts — left untouched
    refs.push(path);
    return "";
  });
  return { text: text.replace(/\s{2,}/g, " ").trim(), refs: refs.slice(0, config.maxImagesPerMessage) };
}

export type LoadedImage =
  | { ok: true; part: ImagePart; mime: string; bytes: number; abs: string }
  | { ok: false; reason: string };

// Read + validate one attachment.
export async function loadImage(userPath: string): Promise<LoadedImage> {
  let abs: string;
  try {
    // OUT-OF-ROOT IS ALLOWED HERE, unlike every tool path — a deliberate difference. The root fence
    // exists to stop the MODEL reaching outside the project; this is the USER naming a file with
    // their own keystrokes (~/Desktop/mockup.png is the common case), and there is no tool call to
    // gate. The resolved absolute path is echoed back in the confirmation line so it stays visible.
    abs = resolveInRoot(userPath).abs;
  } catch {
    return { ok: false, reason: `"${userPath}" is not a valid path` };
  }
  let bytes: number;
  try {
    const st = await stat(abs);
    if (!st.isFile()) return { ok: false, reason: `${userPath} is not a file` };
    bytes = st.size;
  } catch {
    return { ok: false, reason: `${userPath} not found` };
  }
  if (bytes > config.maxImageBytes) {
    return { ok: false, reason: `${userPath} is ${(bytes / 1_000_000).toFixed(1)} MB — over the ${(config.maxImageBytes / 1_000_000).toFixed(0)} MB limit` };
  }
  // Guarded like the stat above: a file you can stat but not READ (mode 0600 owned by someone else)
  // throws EACCES here. Unguarded, that rejection escaped the REPL loop into main().catch and took
  // the whole conversation with it.
  let buf: Buffer;
  try {
    buf = await readFile(abs);
  } catch {
    return { ok: false, reason: `${userPath} could not be read (permission denied?)` };
  }
  const mime = sniffImage(buf); // magic bytes, never the extension
  if (!mime) return { ok: false, reason: `${userPath} is not a PNG, JPEG, WebP or GIF` };
  return { ok: true, part: imagePart(mime, buf), mime, bytes, abs };
}
