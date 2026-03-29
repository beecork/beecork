import { chunkText, timeAgo } from '../util/text.js';

// Re-export for existing imports
export { chunkText };

/** Format a tab status message */
export function formatTabStatus(tabs: Array<{ name: string; status: string; lastActivityAt: string }>): string {
  if (tabs.length === 0) return 'No tabs.';
  return tabs.map(t => {
    const ago = timeAgo(t.lastActivityAt);
    return `• ${t.name} [${t.status}] — ${ago}`;
  }).join('\n');
}
