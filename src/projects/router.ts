import { getDb } from '../db/index.js';
import { logger } from '../util/logger.js';
import { listProjects, getProject, ensureCategory, touchProject } from './manager.js';
import type { Project, RouteDecision, RoutingContext } from './types.js';

// Category keywords for non-project routing
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  research: ['research', 'find out', 'look into', 'compare', 'investigate', 'analyze', 'study'],
  planning: ['plan', 'schedule', 'organize', 'roadmap', 'strategy', 'outline', 'agenda'],
};

// Per-user current context tracking (in-memory, resets on daemon restart)
const userContext = new Map<string, { projectName: string; tabName: string; updatedAt: number }>();

/** Route a message to the right project and tab */
export function routeMessage(message: string, context?: RoutingContext): RouteDecision {
  const projects = listProjects().filter(p => p.type === 'user-project');
  const userId = context?.userId || 'default';

  // 1. Check for explicit project mention by name
  const mentionedProject = findMentionedProject(message, projects);
  if (mentionedProject) {
    const tabName = resolveTabInProject(mentionedProject, message, context);
    touchProject(mentionedProject.name);
    recordRouting(message, mentionedProject.name);
    return {
      project: mentionedProject,
      tabName,
      isNewTab: !tabExists(tabName),
      confidence: 0.95,
      needsConfirmation: false,
      reason: `Message mentions project "${mentionedProject.name}"`,
    };
  }

  // 2. Check if continuing current context
  const currentCtx = userContext.get(userId);
  if (currentCtx && Date.now() - currentCtx.updatedAt < 10 * 60 * 1000) { // 10 min window
    const project = getProject(currentCtx.projectName);
    if (project) {
      touchProject(project.name);
      return {
        project,
        tabName: currentCtx.tabName,
        isNewTab: false,
        confidence: 0.7,
        needsConfirmation: false,
        reason: `Continuing in "${project.name}" (recent context)`,
      };
    }
  }

  // 3. Check routing preferences (learned patterns)
  const learned = checkLearnedRouting(message);
  if (learned) {
    const project = getProject(learned.projectName);
    if (project && learned.confidence >= 0.9) {
      const tabName = resolveTabInProject(project, message, context);
      touchProject(project.name);
      return {
        project,
        tabName,
        isNewTab: !tabExists(tabName),
        confidence: learned.confidence,
        needsConfirmation: false,
        reason: `Learned pattern → "${project.name}"`,
      };
    }
  }

  // 4. Multiple projects could match — ask user
  const possibleMatches = findPossibleMatches(message, projects);
  if (possibleMatches.length > 1) {
    return {
      project: possibleMatches[0],
      tabName: possibleMatches[0].name,
      isNewTab: false,
      confidence: 0.5,
      needsConfirmation: true,
      reason: `Multiple projects could match: ${possibleMatches.map(p => p.name).join(', ')}`,
    };
  }

  // 5. Check for category keywords (non-project)
  const category = detectCategory(message);
  if (category) {
    const project = ensureCategory(category);
    const tabName = category;
    return {
      project,
      tabName,
      isNewTab: !tabExists(tabName),
      confidence: 0.8,
      needsConfirmation: false,
      reason: `Detected category: ${category}`,
    };
  }

  // 6. Default to general
  const general = ensureCategory('general');
  return {
    project: general,
    tabName: 'general',
    isNewTab: !tabExists('general'),
    confidence: 0.6,
    needsConfirmation: false,
    reason: 'Default routing to general',
  };
}

/** Update current context for a user */
export function setUserContext(userId: string, projectName: string, tabName: string): void {
  userContext.set(userId, { projectName, tabName, updatedAt: Date.now() });
  // Evict oldest entry when map grows too large
  if (userContext.size > 1000) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [key, val] of userContext) {
      if (val.updatedAt < oldestTime) { oldestTime = val.updatedAt; oldestKey = key; }
    }
    if (oldestKey) userContext.delete(oldestKey);
  }
}

/** Find a project explicitly mentioned by name in the message */
function findMentionedProject(message: string, projects: Project[]): Project | null {
  const lower = message.toLowerCase();
  // Check for exact project name mentions
  for (const project of projects) {
    if (lower.includes(project.name.toLowerCase())) {
      return project;
    }
  }
  return null;
}

/** Find possible project matches (for ambiguity) */
function findPossibleMatches(message: string, projects: Project[]): Project[] {
  const lower = message.toLowerCase();
  const words = lower.split(/\s+/);
  return projects.filter(p => {
    const nameParts = p.name.toLowerCase().split(/[-_]/);
    return nameParts.some(part => words.includes(part));
  });
}

/** Resolve which tab to use within a project */
function resolveTabInProject(project: Project, _message: string, _context?: RoutingContext): string {
  const db = getDb();

  // Find existing tabs for this project
  const tabs = db.prepare(
    'SELECT name, last_activity_at FROM tabs WHERE working_dir = ? ORDER BY last_activity_at DESC'
  ).all(project.path) as Array<{ name: string; last_activity_at: string }>;

  if (tabs.length === 0) {
    // No tabs yet — use project name as tab name
    return project.name;
  }

  // Use most recently active tab in this project
  return tabs[0].name;
}

/** Check if a tab exists in the database */
function tabExists(tabName: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM tabs WHERE name = ?').get(tabName);
  return !!row;
}

/** Detect a category from keywords */
function detectCategory(message: string): string | null {
  const lower = message.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return null;
}

/** Record a successful routing for learning */
function recordRouting(message: string, projectName: string): void {
  const db = getDb();
  // Extract key words from message for pattern matching
  const words = message.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
  const pattern = words.join(' ');
  if (!pattern) return;

  db.prepare(`
    INSERT INTO routing_preferences (pattern, project_name)
    VALUES (?, ?)
    ON CONFLICT(pattern, project_name) DO UPDATE SET hit_count = hit_count + 1
  `).run(pattern, projectName);
}

/** Check learned routing preferences */
function checkLearnedRouting(message: string): { projectName: string; confidence: number } | null {
  const db = getDb();
  const words = message.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (words.length === 0) return null;

  // Fetch all preferences in a single query and match in JS
  const allPrefs = db.prepare(
    'SELECT pattern, project_name, confidence, hit_count FROM routing_preferences WHERE hit_count >= 3 ORDER BY hit_count DESC'
  ).all() as Array<{ pattern: string; project_name: string; confidence: number; hit_count: number }>;

  for (const pref of allPrefs) {
    const patternLower = pref.pattern.toLowerCase();
    if (words.some(word => patternLower.includes(word) || word.includes(patternLower))) {
      return { projectName: pref.project_name, confidence: Math.min(pref.confidence, 0.9) };
    }
  }

  return null;
}
