import { logger } from '../../util/logger.js';

interface PollOptions {
  statusUrl: string;
  headers: Record<string, string>;
  isComplete: (data: any) => boolean;
  isFailed: (data: any) => string | null; // returns error message or null
  getResultUrl: (data: any) => string;
  interval?: number;
  maxAttempts?: number;
  label?: string;
}

export async function pollForCompletion(opts: PollOptions): Promise<string> {
  const { statusUrl, headers, isComplete, isFailed, getResultUrl, interval = 5000, maxAttempts = 60, label = 'API' } = opts;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, interval));
    const resp = await fetch(statusUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) {
      logger.warn(`[${label}] Poll failed: ${resp.status}`);
      if (resp.status >= 400 && resp.status < 500) {
        throw new Error(`${label} API error: ${resp.status}`);
      }
      continue;
    }
    const data = await resp.json();
    const failMsg = isFailed(data);
    if (failMsg) throw new Error(`${label} generation failed: ${failMsg}`);
    if (isComplete(data)) return getResultUrl(data);
  }
  throw new Error(`${label} generation timed out after ${maxAttempts * interval / 1000}s`);
}
