// Image handling: sniffing, data URLs, and the one place that flattens multi-part content back to
// text. No dependencies — a data URL is all any provider needs, so there is nothing to decode.
//
// The load-bearing rule lives in textOf(): an image NEVER renders as its data URL. Everything that
// turns a message into a string for some other purpose — the compaction summarizer, the /resume
// preview, the session picker — goes through it, which is what structurally prevents a megabyte of
// base64 from being posted to a summarization endpoint or written into a session file.

import { config } from "./config";
import type { Content, ContentPart, ImagePart, Message, ToolResult } from "./types";

// The four types every major provider accepts. Anything else is refused before it becomes a data URL.
const MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMime = (typeof MIMES)[number];

// Identify an image by MAGIC BYTES, never by file extension — the extension is user-supplied and a
// mislabeled file would be rejected by the provider with an opaque error instead of by us with a
// clear one.
export function sniffImage(buf: Buffer): ImageMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export const dataUrl = (mime: string, buf: Buffer): string => `data:${mime};base64,${buf.toString("base64")}`;
export const imagePart = (mime: string, buf: Buffer): ImagePart => ({ type: "image_url", image_url: { url: dataUrl(mime, buf) } });

// Recover the mime + original byte size from a data URL, for chips and token estimates. base64 is
// 4 chars per 3 bytes, so the decoded length is derivable without decoding.
export function describePart(p: ImagePart): { mime: string; bytes: number } {
  const url = p.image_url?.url ?? "";
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (!m) return { mime: "image", bytes: 0 };
  const b64 = m[2];
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return { mime: m[1], bytes: Math.max(0, Math.floor((b64.length * 3) / 4) - pad) };
}

const kb = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);

export const isMultipart = (c: Content): c is ContentPart[] => Array.isArray(c);

// Flatten any Content to plain text. An image becomes a short description — NEVER its data URL.
export function textOf(c: Content): string {
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c
    .map((p) => (p.type === "text" ? p.text : (() => { const d = describePart(p); return `[image: ${d.mime}, ${kb(d.bytes)}]`; })()))
    .join(" ")
    .trim();
}

export function imageCount(c: Content): number {
  return Array.isArray(c) ? c.filter((p) => p.type === "image_url").length : 0;
}

// Normalize ANY ToolResult shape into text + images, so every call site can treat tools uniformly.
// A structured failure surfaces its `message` as the text; the failure CODE is not this function's
// business — toOutcome (tools.ts) carries that through separately.
export function splitResult(r: ToolResult): { text: string; images: ImagePart[] } {
  if (typeof r === "string") return { text: r, images: [] };
  if ("ok" in r) return { text: r.message, images: r.images ?? [] }; // the only member carrying `ok`
  return { text: r.text, images: r.images ?? [] };
}

// Build the synthesized user message carrying images that tools returned during one assistant step.
// Pure, so it's unit-testable. Returns null when there's nothing to attach.
export function buildAttachmentMessage(items: { part: ImagePart; tool: string }[]): Message | null {
  if (!items.length) return null;
  const capped = items.slice(0, config.maxImagesPerMessage);
  const names = [...new Set(capped.map((i) => i.tool))].join(", ");
  const dropped = items.length - capped.length;
  const lead =
    `[automatic] ${capped.length} image(s) returned by ${names}, attached below.` +
    (dropped ? ` ${dropped} more were dropped (limit ${config.maxImagesPerMessage} per step).` : "");
  // Text first, then images: OpenRouter's guidance is to lead with the text prompt.
  return { role: "user", attached: true, content: [{ type: "text", text: lead }, ...capped.map((i) => i.part)] };
}

// Replace an image part with a text placeholder, preserving message count, roles and tool pairing.
const placeholder = (why: string): ContentPart => ({ type: "text", text: `[image ${why}]` });

// Sessions exist to RESUME a conversation, not to archive pixels. One screenshot is ~1 MB of base64,
// MAX_SESSIONS is 50 per project, and listSessions parses EVERY file to build the /resume picker —
// so images are stripped on save. A parts array that becomes all-text collapses back to a string.
export function stripImagesForSave(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (!Array.isArray(m.content) || !imageCount(m.content)) return m;
    const parts = m.content.map((p) => (p.type === "image_url" ? placeholder("omitted from the saved session") : p));
    const allText = parts.every((p) => p.type === "text");
    const { attached, ...rest } = m;
    return { ...rest, content: allText ? textOf(parts) : parts };
  });
}

// Cap how many images stay LIVE in the conversation. Compaction keeps the recent tail verbatim, so
// without this a few screenshots in that tail are un-shrinkable and the turn fails outright with a
// provider rejection. Replaces older images IN PLACE so nothing about the message structure moves.
export function pruneOldImages(messages: Message[], keep = config.maxLiveImages): Message[] {
  const positions: { mi: number; pi: number }[] = [];
  messages.forEach((m, mi) => {
    if (Array.isArray(m.content)) m.content.forEach((p, pi) => { if (p.type === "image_url") positions.push({ mi, pi }); });
  });
  if (positions.length <= keep) return messages;
  const drop = new Set(positions.slice(0, positions.length - keep).map((p) => `${p.mi}:${p.pi}`));
  return messages.map((m, mi) => {
    if (!Array.isArray(m.content)) return m;
    if (!m.content.some((_, pi) => drop.has(`${mi}:${pi}`))) return m;
    return { ...m, content: m.content.map((p, pi) => (drop.has(`${mi}:${pi}`) ? placeholder("dropped from context to save tokens — re-capture it if you still need it") : p)) };
  });
}
