// Minimal HTML → readable text. Not a real parser — just enough to drop markup,
// scripts, styles, and comments so the model gets clean text. This also shrinks
// the hidden-instruction surface (white-on-white text, comments, etc.) that a
// malicious page would use to smuggle prompt-injection.

export function htmlToText(html: string): string {
  let s = html;
  // Remove script/style/etc. blocks ENTIRELY (content + tags).
  s = s.replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1>/gi, " ");
  // Remove HTML comments — a classic place to hide instructions.
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Turn block boundaries into newlines so text doesn't run together.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|blockquote)\s*>/gi, "\n");
  // Strip every remaining tag.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode the common HTML entities.
  s = decodeEntities(s);
  // Tidy whitespace: collapse spaces, cap blank-line runs, trim line ends.
  s = s
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}
