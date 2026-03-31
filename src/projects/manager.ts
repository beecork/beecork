import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import { getConfig } from '../config.js';
import { logger } from '../util/logger.js';
import type { Project } from './types.js';

/** Get the workspace root from config */
export function getWorkspaceRoot(): string {
  const config = getConfig();
  // Use the default tab's workingDir as workspace root
  const root = config.tabs?.default?.workingDir || process.env.HOME || '';
  return root.startsWith('~') ? root.replace('~', process.env.HOME || '') : root;
}

/** Get the managed workspace path (.beecork/ under workspace root) */
export function getManagedWorkspace(): string {
  return path.join(getWorkspaceRoot(), '.beecork');
}

/** Discover projects in scan paths (look for git repos, package.json, etc.) */
export function discoverProjects(scanPaths?: string[]): Project[] {
  const paths = scanPaths || [getWorkspaceRoot()];
  const projects: Project[] = [];
  const db = getDb();

  for (let scanPath of paths) {
    scanPath = scanPath.startsWith('~') ? scanPath.replace('~', process.env.HOME || '') : scanPath;
    if (!fs.existsSync(scanPath)) continue;

    try {
      const entries = fs.readdirSync(scanPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue; // Skip hidden dirs
        if (entry.name === 'node_modules') continue;

        const dirPath = path.join(scanPath, entry.name);

        // Check if it looks like a project (has .git, package.json, or similar)
        const isProject = fs.existsSync(path.join(dirPath, '.git'))
          || fs.existsSync(path.join(dirPath, 'package.json'))
          || fs.existsSync(path.join(dirPath, 'Cargo.toml'))
          || fs.existsSync(path.join(dirPath, 'go.mod'))
          || fs.existsSync(path.join(dirPath, 'requirements.txt'))
          || fs.existsSync(path.join(dirPath, 'pyproject.toml'))
          || fs.existsSync(path.join(dirPath, 'CLAUDE.md'));

        if (isProject) {
          projects.push({
            id: uuidv4(),
            name: entry.name,
            path: dirPath,
            type: 'user-project',
            lastUsedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      logger.warn(`Failed to scan ${scanPath}:`, err);
    }
  }

  // Upsert into database
  for (const project of projects) {
    db.prepare(`
      INSERT INTO projects (id, name, path, type) VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET path = excluded.path, last_used_at = datetime('now')
    `).run(project.id, project.name, project.path, project.type);
  }

  return projects;
}

/** Create a new project */
export function createProject(name: string, parentDir?: string): Project {
  const parent = parentDir || getWorkspaceRoot();
  const projectPath = path.join(parent, name);

  if (fs.existsSync(projectPath)) {
    // Folder already exists — just register it
    logger.info(`Project folder already exists: ${projectPath}`);
  } else {
    fs.mkdirSync(projectPath, { recursive: true });
    logger.info(`Created project folder: ${projectPath}`);
  }

  const db = getDb();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO projects (id, name, path, type) VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET path = excluded.path
  `).run(id, name, projectPath, 'user-project');

  return { id, name, path: projectPath, type: 'user-project', lastUsedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

/** Ensure a managed category exists (lazy creation) */
export function ensureCategory(name: string): Project {
  const categoryPath = path.join(getManagedWorkspace(), name);
  fs.mkdirSync(categoryPath, { recursive: true });

  const db = getDb();
  const existing = db.prepare('SELECT * FROM projects WHERE name = ? AND type = ?').get(name, 'category') as any;
  if (existing) {
    return { id: existing.id, name: existing.name, path: existing.path, type: 'category', lastUsedAt: existing.last_used_at, createdAt: existing.created_at };
  }

  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, name, path, type) VALUES (?, ?, ?, ?)').run(id, name, categoryPath, 'category');
  return { id, name, path: categoryPath, type: 'category', lastUsedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
}

/** List all projects */
export function listProjects(): Project[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM projects ORDER BY type, last_used_at DESC').all() as any[];
  return rows.map(r => ({
    id: r.id, name: r.name, path: r.path, type: r.type,
    lastUsedAt: r.last_used_at, createdAt: r.created_at,
  }));
}

/** Get a project by name */
export function getProject(name: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as any;
  if (!row) return null;
  return { id: row.id, name: row.name, path: row.path, type: row.type, lastUsedAt: row.last_used_at, createdAt: row.created_at };
}

/** Update last used timestamp */
export function touchProject(name: string): void {
  getDb().prepare("UPDATE projects SET last_used_at = datetime('now') WHERE name = ?").run(name);
}

/** Close (permanently delete) a tab */
export function closeTab(tabName: string): boolean {
  const db = getDb();
  const tab = db.prepare('SELECT id FROM tabs WHERE name = ?').get(tabName) as any;
  if (!tab) return false;
  db.prepare('DELETE FROM messages WHERE tab_id = ?').run(tab.id);
  db.prepare('DELETE FROM tabs WHERE id = ?').run(tab.id);
  logger.info(`Tab permanently closed: ${tabName}`);
  return true;
}
