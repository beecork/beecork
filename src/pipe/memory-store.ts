import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/index.js';
import type { Project, PermissionEntry, KnowledgeEntry } from './types.js';

export class PipeMemoryStore {
  // ─── Projects ───

  getProjects(): Project[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM projects ORDER BY last_used DESC NULLS LAST').all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      path: r.path as string,
      description: (r.description as string) || '',
      languages: JSON.parse((r.languages as string) || '[]'),
      lastUsed: r.last_used as string | null,
      tabName: r.tab_name as string | null,
      discoveredVia: (r.discovered_via as Project['discoveredVia']) || 'scan',
      createdAt: r.created_at as string,
    }));
  }

  upsertProject(project: Project): void {
    const db = getDb();
    db.prepare(`INSERT INTO projects (id, name, path, description, languages, last_used, tab_name, discovered_via)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name=excluded.name, description=excluded.description, languages=excluded.languages,
        last_used=excluded.last_used, tab_name=excluded.tab_name, updated_at=datetime('now')
    `).run(project.id || uuidv4(), project.name, project.path, project.description,
      JSON.stringify(project.languages), project.lastUsed, project.tabName, project.discoveredVia);
  }

  findProjectByName(name: string): Project | undefined {
    const projects = this.getProjects();
    return projects.find(p => p.name.toLowerCase() === name.toLowerCase());
  }

  updateProjectLastUsed(path: string): void {
    const db = getDb();
    db.prepare('UPDATE projects SET last_used = datetime("now") WHERE path = ?').run(path);
  }

  // ─── Preferences ───

  getPreference(key: string): string | null {
    const db = getDb();
    const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setPreference(key: string, value: string): void {
    const db = getDb();
    db.prepare('INSERT INTO preferences (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime("now")')
      .run(key, value);
  }

  // ─── Permission History ───

  getPermissionHistory(toolName: string, limit: number = 10): PermissionEntry[] {
    const db = getDb();
    return db.prepare(
      'SELECT * FROM permission_history WHERE tool_name = ? ORDER BY created_at DESC LIMIT ?'
    ).all(toolName, limit) as PermissionEntry[];
  }

  recordPermission(toolName: string, argsPattern: string, decision: 'allow' | 'deny', confidence: number, context: string | null, tabName: string | null): void {
    const db = getDb();
    db.prepare(
      'INSERT INTO permission_history (tool_name, tool_args_pattern, decision, confidence, context, tab_name) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(toolName, argsPattern, decision, confidence, context, tabName);
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
