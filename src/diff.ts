// A tiny line-level diff (longest-common-subsequence) → unified-ish output with
// "- " (removed), "+ " (added), "  " (unchanged) prefixes. Used to preview an
// edit before you approve it. Small + pure so it can be unit-tested.

export function lineDiff(oldText: string, newText: string): string {
  const a = oldText ? oldText.split("\n") : []; // "" = zero lines, not one empty line
  const b = newText ? newText.split("\n") : [];
  // Skip the O(m·n) LCS for very large inputs — only a short preview is shown anyway,
  // so a 5000×5000 matrix would just be wasted work.
  if (a.length * b.length > 4_000_000) {
    return `- (${a.length} lines)\n+ (${b.length} lines)  [too large to diff — preview suppressed]`;
  }
  const m = a.length;
  const n = b.length;

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push("  " + a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push("- " + a[i]);
      i++;
    } else {
      out.push("+ " + b[j]);
      j++;
    }
  }
  while (i < m) out.push("- " + a[i++]);
  while (j < n) out.push("+ " + b[j++]);
  return out.join("\n");
}
