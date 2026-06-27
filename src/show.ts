// The `show` sub-system: the rich USER-facing views (a file box, a directory listing, a
// file tree) plus the tagged payload protocol that carries a structured `show` result from
// the tool (tools.ts builds via showPayload) to the agent loop (renders via renderShow).
// The model only ever gets renderShow's short note, never the file contents — that's the
// "hand over a file instead of re-typing it" mechanism, kept as one named unit.

import { color, stripControl } from "./ui";

// No right border (robust against wrapping and varying width) — just a header, a left bar, a footer rule.
const BOX_W = () => Math.min(process.stdout.columns || 80, 100);

function renderFileBox(path: string, startLine: number, lines: string[], hasMore: boolean): string {
  const p = stripControl(path);
  const numW = String(startLine + Math.max(0, lines.length - 1)).length;
  const header = startLine === 1 && !hasMore
    ? `${lines.length} line${lines.length === 1 ? "" : "s"}`
    : `lines ${startLine}–${startLine + lines.length - 1}${hasMore ? " (+ more)" : ""}`;
  const out = [color.dim("╭─ ") + color.bold(p) + color.dim(`  ${header}`)];
  lines.forEach((l, i) => out.push(color.dim("│ ") + color.dim(String(startLine + i).padStart(numW)) + "  " + stripControl(l)));
  if (hasMore) out.push(color.dim("│ ") + color.dim(`… more (show ${p} offset ${startLine + lines.length})`));
  out.push(color.dim("╰─"));
  return out.join("\n") + "\n";
}

function renderListing(path: string, names: string[]): string {
  const safe = names.map(stripControl); // names are repo-controlled — strip escapes
  const out = [color.dim("╭─ ") + color.bold(stripControl(path)) + color.dim(`  ${safe.length} entr${safe.length === 1 ? "y" : "ies"}`)];
  if (safe.length === 0) {
    out.push(color.dim("│ ") + color.dim("(empty)"));
  } else {
    const avail = BOX_W() - 2;
    const colW = Math.min(Math.max(...safe.map((n) => n.length)) + 2, 40);
    const cols = Math.max(1, Math.floor(avail / colW));
    const rows = Math.ceil(safe.length / cols);
    for (let r = 0; r < rows; r++) {
      let line = "";
      for (let c = 0; c < cols; c++) {
        const idx = c * rows + r; // column-major so entries read down then across
        if (idx >= safe.length) continue;
        const n = safe[idx];
        line += (n.endsWith("/") ? color.cyan(n) : n) + " ".repeat(Math.max(1, colW - n.length));
      }
      out.push(color.dim("│ ") + line.replace(/\s+$/, ""));
    }
  }
  out.push(color.dim("╰─"));
  return out.join("\n") + "\n";
}

function renderTree(path: string, items: { prefix: string; name: string; isDir: boolean }[], truncated: boolean): string {
  const dirs = items.filter((it) => it.isDir).length;
  const out = [color.dim("╭─ ") + color.bold(stripControl(path)) + color.dim(`  ${items.length} entries · ${dirs} folders`)];
  for (const it of items) {
    const nm = stripControl(it.name); // repo-controlled filename — strip escapes
    out.push(color.dim("│ ") + color.dim(it.prefix) + (it.isDir ? color.cyan(nm) : nm));
  }
  if (truncated) out.push(color.dim("│ ") + color.dim("… (truncated)"));
  out.push(color.dim("╰─"));
  return out.join("\n") + "\n";
}

// The `show` tool returns a tagged payload (\x01KIND\x01 + JSON) that the agent loop renders
// for the USER via renderShow; the model gets only renderShow's short note. One builder + one
// parser so the tag/offset can't drift.
const SHOW_MARK = "\x01";
const SHOW_KINDS = ["file", "dir", "tree"] as const;
const SHOW_RE = new RegExp(`^${SHOW_MARK}(${SHOW_KINDS.join("|")})${SHOW_MARK}`); // derived from the same source as the builder
export type ShowKind = (typeof SHOW_KINDS)[number];
export function showPayload(kind: ShowKind, obj: unknown): string {
  return SHOW_MARK + kind + SHOW_MARK + JSON.stringify(obj);
}

export function renderShow(raw: string): { display: string; note: string } | null {
  const m = raw.match(SHOW_RE);
  if (!m) return null;
  let p: any;
  try {
    p = JSON.parse(raw.slice(m[0].length)); // split past the SECOND mark — no magic offset
  } catch {
    return null;
  }
  if (m[1] === "file") {
    const range = `lines ${p.startLine}–${p.startLine + p.lines.length - 1}${p.hasMore ? ", more follow" : ""}`;
    return {
      display: renderFileBox(p.path, p.startLine, p.lines, p.hasMore),
      note: `Shown ${p.path} (${range}) on the user's screen — they can see it now. Do NOT paste, re-list, or re-describe its contents; add at most a one-line comment, or ask what's next. (If YOU need the contents to answer something, use read_file.)`,
    };
  }
  if (m[1] === "dir") {
    return {
      display: renderListing(p.path, p.names),
      note: `Shown the contents of ${p.path} (${p.names.length} entries) on the user's screen. Do NOT re-list or re-format them — a one-line comment at most, or ask what's next.`,
    };
  }
  const dirs = p.items.filter((it: { isDir: boolean }) => it.isDir).length;
  return {
    display: renderTree(p.path, p.items, p.truncated),
    note: `Shown the file tree of ${p.path} (${p.items.length} entries, ${dirs} folders${p.truncated ? ", truncated" : ""}) on the user's screen. Do NOT re-type or re-format the tree — a one-line comment at most.`,
  };
}
