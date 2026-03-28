const TELEGRAM_MAX_LENGTH = 4096;

/** Split long text into chunks that fit within Telegram's message limit */
export function chunkText(text: string, maxLength: number = TELEGRAM_MAX_LENGTH): string[] {
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

/** Escape special characters for Telegram MarkdownV2 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Format a tab status message */
export function formatTabStatus(tabs: Array<{ name: string; status: string; lastActivityAt: string }>): string {
  if (tabs.length === 0) return 'No tabs.';
  return tabs.map(t => {
    const ago = timeAgo(t.lastActivityAt);
    return `• ${t.name} [${t.status}] — ${ago}`;
  }).join('\n');
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
