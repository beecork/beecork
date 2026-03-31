import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import { getBeecorkHome } from '../util/paths.js';
import { logger } from '../util/logger.js';
import type { KnowledgeEntry, KnowledgeScope } from './types.js';

const GLOBAL_KNOWLEDGE_DIR = path.join(getBeecorkHome(), 'knowledge');
const GLOBAL_CATEGORIES = ['people', 'preferences', 'routines', 'general'];

/** Ensure global knowledge directory exists */
function ensureGlobalDir(): void {
  fs.mkdirSync(GLOBAL_KNOWLEDGE_DIR, { recursive: true });
}

/** Read a knowledge file, return content or empty string */
function readKnowledgeFile(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf-8');
  } catch {}
  return '';
}

/** Append to a knowledge file */
function appendToFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = readKnowledgeFile(filePath);
  const separator = existing.endsWith('\n') || existing === '' ? '' : '\n';
  fs.writeFileSync(filePath, existing + separator + content + '\n');
}

// ─── Layer 1: Global Knowledge ───

export function getGlobalKnowledge(): KnowledgeEntry[] {
  ensureGlobalDir();
  const entries: KnowledgeEntry[] = [];
  for (const category of GLOBAL_CATEGORIES) {
    const filePath = path.join(GLOBAL_KNOWLEDGE_DIR, `${category}.md`);
    const content = readKnowledgeFile(filePath);
    if (content.trim()) {
      entries.push({ content, scope: 'global', source: `${category}.md`, category });
    }
  }
  return entries;
}

export function addGlobalKnowledge(content: string, category: string = 'general'): void {
  ensureGlobalDir();
  const validCategory = GLOBAL_CATEGORIES.includes(category) ? category : 'general';
  const filePath = path.join(GLOBAL_KNOWLEDGE_DIR, `${validCategory}.md`);
  appendToFile(filePath, content);
  logger.info(`Global knowledge added to ${validCategory}.md`);
}

// ─── Layer 2: Project Knowledge ───

export function getProjectKnowledge(projectPath: string): KnowledgeEntry[] {
  const filePath = path.join(projectPath, '.beecork', 'knowledge.md');
  const content = readKnowledgeFile(filePath);
  if (!content.trim()) return [];
  return [{ content, scope: 'project', source: filePath }];
}

export function addProjectKnowledge(projectPath: string, content: string): void {
  const filePath = path.join(projectPath, '.beecork', 'knowledge.md');
  appendToFile(filePath, content);
  logger.info(`Project knowledge added to ${filePath}`);
}

// ─── Layer 3: Tab Knowledge (database) ───

export function getTabKnowledge(tabName: string): KnowledgeEntry[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT content FROM memories WHERE tab_name = ? ORDER BY created_at DESC LIMIT 50'
  ).all(tabName) as Array<{ content: string }>;
  return rows.map(r => ({ content: r.content, scope: 'tab' as const, source: tabName }));
}

// ─── Combined Knowledge ───

export function getAllKnowledge(projectPath?: string, tabName?: string): KnowledgeEntry[] {
  const entries: KnowledgeEntry[] = [];

  // Layer 1: Global
  entries.push(...getGlobalKnowledge());

  // Layer 2: Project (if provided)
  if (projectPath) {
    entries.push(...getProjectKnowledge(projectPath));
  }

  // Layer 3: Tab (if provided)
  if (tabName) {
    entries.push(...getTabKnowledge(tabName));
  }

  return entries;
}

/** Format knowledge for injection into Claude's context */
export function formatKnowledgeForContext(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '';

  const sections: string[] = [];

  const global = entries.filter(e => e.scope === 'global');
  if (global.length > 0) {
    sections.push('[Your knowledge (global)]');
    for (const entry of global) {
      if (entry.category) sections.push(`[${entry.category}]`);
      sections.push(entry.content);
    }
  }

  const project = entries.filter(e => e.scope === 'project');
  if (project.length > 0) {
    sections.push('\n[Project knowledge]');
    for (const entry of project) {
      sections.push(entry.content);
    }
  }

  const tab = entries.filter(e => e.scope === 'tab');
  if (tab.length > 0) {
    sections.push('\n[Context from memory]');
    for (const entry of tab) {
      sections.push(`- ${entry.content}`);
    }
  }

  return sections.join('\n');
}

/** Add knowledge to the right scope */
export function addKnowledge(content: string, scope: KnowledgeScope, options?: {
  projectPath?: string;
  tabName?: string;
  category?: string;
}): void {
  switch (scope) {
    case 'global':
      addGlobalKnowledge(content, options?.category);
      break;
    case 'project':
      if (!options?.projectPath) throw new Error('projectPath required for project scope');
      addProjectKnowledge(options.projectPath, content);
      break;
    case 'tab': {
      // Use existing memory system
      const db = getDb();
      db.prepare('INSERT INTO memories (content, tab_name, source) VALUES (?, ?, ?)').run(
        content, options?.tabName || null, 'tool'
      );
      break;
    }
  }
}

/** Search knowledge across all layers */
export function searchKnowledge(query: string, projectPath?: string, tabName?: string): KnowledgeEntry[] {
  const all = getAllKnowledge(projectPath, tabName);
  const lower = query.toLowerCase();
  return all.filter(e => e.content.toLowerCase().includes(lower));
}
