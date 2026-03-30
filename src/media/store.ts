import fs from 'node:fs';
import path from 'node:path';
import { getBeecorkHome } from '../util/paths.js';
import { logger } from '../util/logger.js';

const MEDIA_DIR = path.join(getBeecorkHome(), 'media');
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_SIZE_MB = 25;

/** Ensure media directory exists */
export function ensureMediaDir(): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  return MEDIA_DIR;
}

/** Save a buffer to the media directory with a unique filename */
export function saveMedia(buffer: Buffer, extension: string, originalName?: string): string {
  ensureMediaDir();
  const timestamp = Date.now();
  const name = originalName
    ? `${timestamp}-${originalName}`
    : `${timestamp}.${extension}`;
  const filePath = path.join(MEDIA_DIR, name);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Check if a file exceeds the size limit */
export function isOversized(sizeBytes: number, maxSizeMb: number = DEFAULT_MAX_SIZE_MB): boolean {
  return sizeBytes > maxSizeMb * 1024 * 1024;
}

/** Clean up expired media files */
export function cleanupMedia(ttlMs: number = DEFAULT_TTL_MS): number {
  if (!fs.existsSync(MEDIA_DIR)) return 0;
  const now = Date.now();
  let cleaned = 0;
  for (const file of fs.readdirSync(MEDIA_DIR)) {
    const filePath = path.join(MEDIA_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > ttlMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch { /* file may have been deleted by another process */ }
  }
  if (cleaned > 0) logger.info(`Media cleanup: removed ${cleaned} expired files`);
  return cleaned;
}

/** Get the media directory path */
export function getMediaDir(): string {
  return MEDIA_DIR;
}
