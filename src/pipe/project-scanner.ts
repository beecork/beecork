import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';
import type { Project } from './types.js';

/**
 * Read projects from the database (populated by discoverProjects() at daemon startup).
 * Falls back to an empty list if the DB is not yet initialized.
 */
export function scanForProjects(_scanPaths: string[]): Project[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_used_at DESC').all() as any[];
    const projects: Project[] = rows.map(r => ({
      id: r.id,
      name: r.name,
      path: r.path,
      type: r.type,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    }));
    logger.info(`Project scanner: found ${projects.length} projects from DB`);
    return projects;
  } catch (err) {
    logger.warn('Project scanner: failed to read from DB, returning empty list:', err);
    return [];
  }
}
