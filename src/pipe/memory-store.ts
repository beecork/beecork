import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import type { Project, KnowledgeEntry } from './types.js';

export class PipeMemoryStore {
  // ─── Projects ───

  getProjects(): Project[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_used_at DESC NULLS LAST').all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      path: r.path as string,
      type: (r.type as string) || 'user-project',
      lastUsedAt: r.last_used_at as string,
      createdAt: r.created_at as string,
    }));
  }

  upsertProject(project: Project): void {
    const db = getDb();
    db.prepare(`INSERT INTO projects (id, name, path, type)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        path=excluded.path, type=excluded.type, last_used_at=datetime('now')
    `).run(project.id || uuidv4(), project.name, project.path, project.type || 'user-project');
  }

  updateProjectLastUsed(path: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET last_used_at = datetime("now") WHERE path = ?').run(path);
  }

  // ─── Routing History ───

  getRecentRouting(limit: number = 10): string[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT message_preview, tab_name, confidence FROM routing_history ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as Array<{ message_preview: string; tab_name: string; confidence: number }>;
    return rows.map(r => `"${r.message_preview}" → ${r.tab_name} (${Math.round(r.confidence * 100)}%)`);
  }

  recordRouting(messagePreview: string, tabName: string, projectPath: string | null, confidence: number): void {
    const db = getDb();
    db.prepare(
      'INSERT INTO routing_history (message_preview, tab_name, project_path, confidence) VALUES (?, ?, ?, ?)'
    ).run(messagePreview.slice(0, 200), tabName, projectPath, confidence);
  }

  // ─── Knowledge ───

  addKnowledge(entry: KnowledgeEntry): void {
    const db = getDb();
    const content = entry.category ? `[${entry.category}] ${entry.content}` : entry.content;
    db.prepare('INSERT INTO memories (content, tab_name, source) VALUES (?, ?, ?)').run(content, entry.tabName, entry.source);
  }

  getKnowledge(query: string, limit: number = 20): string[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT content FROM memories WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?'
    ).all(`%${query}%`, limit) as Array<{ content: string }>;
    return rows.map(r => r.content);
  }
}
