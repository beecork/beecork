import { logger } from './logger.js';

/** Retry a function with exponential backoff */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  delays: number[] = [1000, 5000, 15000],
  label: string = 'operation',
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < delays.length) {
        logger.warn(`${label} failed (attempt ${attempt + 1}/${delays.length + 1}), retrying in ${delays[attempt]}ms: ${lastError.message}`);
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed after ${delays.length + 1} attempts`);
}
