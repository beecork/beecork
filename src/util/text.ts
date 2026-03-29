const DEFAULT_MAX_LENGTH = 4096;

/** Split long text into chunks that fit within a message limit */
export function chunkText(text: string, maxLength: number = DEFAULT_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to break at a newline
    let breakPoint = remaining.lastIndexOf('\n', maxLength);
    if (breakPoint <= 0 || breakPoint < maxLength * 0.5) {
      // Try to break at a space
      breakPoint = remaining.lastIndexOf(' ', maxLength);
    }
    if (breakPoint <= 0 || breakPoint < maxLength * 0.5) {
      // Hard break
      breakPoint = maxLength;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

/** Format an ISO date as a human-readable relative time */
export function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Parse a "/tab <name> <prompt>" message into tabName + prompt */
export function parseTabMessage(text: string): { tabName: string; prompt: string } {
  if (text.startsWith('/tab ')) {
    const rest = text.slice(5);
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return { tabName: rest, prompt: '' };
    return { tabName: rest.slice(0, spaceIdx), prompt: rest.slice(spaceIdx + 1).trim() };
  }
  return { tabName: 'default', prompt: text };
}
