/**
 * Shared command handler for all channels.
 * Extracts command logic so it's defined once and called from Telegram, WhatsApp, Discord, etc.
 */
import { timeAgo } from '../util/text.js';
import { validateTabName } from '../config.js';
import type { TabManager } from '../session/manager.js';
import type { Project } from '../projects/types.js';

interface WatcherRow {
  name: string;
  enabled: number;
  schedule: string;
  trigger_count: number;
}

interface TaskRow {
  name: string;
  enabled: number;
  schedule_type: string;
  schedule: string;
  tab_name: string;
}

export interface CommandContext {
  userId: string;
  text: string;
  isAdmin: boolean;
  channelId: string;
}

export interface CommandResult {
  handled: boolean;
  response?: string;
}

export interface RouteResult {
  effectiveTabName: string;
  projectPath?: string;
  confirmationMessage?: string;
}

/**
 * Handle shared commands that work identically across all channels.
 * Returns { handled: true, response } if a command was matched.
 * The channel is responsible for sending the response via its own API.
 */
export async function handleSharedCommand(
  ctx: CommandContext,
  tabManager: TabManager,
): Promise<CommandResult> {
  const { text, userId, isAdmin } = ctx;

  // /tabs
  if (text === '/tabs' || text.startsWith('/tabs@')) {
    const tabs = tabManager.listTabs();
    if (tabs.length === 0) return { handled: true, response: 'No tabs.' };
    const list = tabs.map(t => `• ${t.name} [${t.status}] — ${timeAgo(t.lastActivityAt)}`).join('\n');
    return { handled: true, response: list };
  }

  // /stop <name>
  if (text.startsWith('/stop ')) {
    if (!isAdmin) return { handled: true, response: 'Only admin can stop tabs.' };
    const tabName = text.slice(6).trim();
    tabManager.stopTab(tabName);
    return { handled: true, response: `Stopped tab: ${tabName}` };
  }

  // /tab <name> --set-prompt "..."
  if (text.startsWith('/tab ')) {
    const rest = text.slice(5);
    const setPromptMatch = rest.match(/^(\S+)\s+--set-prompt\s+"([^"]+)"/);
    if (setPromptMatch) {
      const tabName = setPromptMatch[1];
      const systemPrompt = setPromptMatch[2];
      const { getDb } = await import('../db/index.js');
      const db = getDb();
      db.prepare('UPDATE tabs SET system_prompt = ? WHERE name = ?').run(systemPrompt, tabName);
      return { handled: true, response: `System prompt updated for tab "${tabName}"` };
    }

    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) {
      return { handled: true, response: 'Usage: /tab <name> <message>' };
    }
    const tabName = rest.slice(0, spaceIdx);
    const validationError = validateTabName(tabName);
    if (validationError) {
      return { handled: true, response: `Invalid tab name: ${validationError}` };
    }
    // /tab with a valid name + message — not handled here, falls through to message handling
    return { handled: false };
  }

  // /register [name]
  if (text === '/register' || text.startsWith('/register ')) {
    const { resolveUser, registerUser, hasAdmin } = await import('../users/index.js');
    const existing = resolveUser(ctx.channelId, userId);
    if (existing) {
      return { handled: true, response: `You're already registered as "${existing.name}" (${existing.role}).` };
    }
    const name = text.slice(10).trim() || `user-${userId}`;
    const role = hasAdmin() ? 'user' : 'admin';
    const user = registerUser(name, ctx.channelId, userId, role);
    return { handled: true, response: `Registered as "${user.name}" (${user.role}).${role === 'admin' ? ' You are the admin.' : ''}` };
  }

  // /link channel:peerId
  if (text.startsWith('/link ')) {
    const { resolveUser, linkIdentity } = await import('../users/index.js');
    const user = resolveUser(ctx.channelId, userId);
    if (!user) return { handled: true, response: 'Register first: /register' };
    const parts = text.slice(6).trim().split(':');
    if (parts.length !== 2) {
      return { handled: true, response: 'Usage: /link channel:peerId (e.g., /link discord:123456789)' };
    }
    const success = linkIdentity(user.id, parts[0], parts[1]);
    return { handled: true, response: success ? `Linked ${parts[0]} identity.` : 'Failed to link — already linked or invalid.' };
  }

  // /users (admin only)
  if (text === '/users') {
    if (!isAdmin) return { handled: true, response: 'Admin only.' };
    const { listUsers } = await import('../users/index.js');
    const users = listUsers();
    if (users.length === 0) return { handled: true, response: 'No registered users.' };
    const list = users.map(u => `• ${u.name} [${u.role}] — ${u.id.slice(0, 8)}`).join('\n');
    return { handled: true, response: `${users.length} user(s):\n${list}` };
  }

  // /watches
  if (text === '/watches' || text.startsWith('/watches@')) {
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const watchers = db.prepare('SELECT * FROM watchers ORDER BY created_at').all() as WatcherRow[];
    if (watchers.length === 0) return { handled: true, response: 'No watchers configured.' };
    const watchList = watchers.map((w) => {
      const status = w.enabled ? 'active' : 'disabled';
      return `[${status}] ${w.name} -- ${w.schedule} (triggers: ${w.trigger_count})`;
    }).join('\n');
    return { handled: true, response: `Watchers:\n${watchList}` };
  }

  // /tasks
  if (text === '/tasks' || text.startsWith('/tasks@')) {
    const { getDb } = await import('../db/index.js');
    const db = getDb();
    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at').all('local') as TaskRow[];
    if (tasks.length === 0) return { handled: true, response: 'No tasks scheduled.' };
    const taskList = tasks.map((t) => {
      const status = t.enabled ? 'enabled' : 'disabled';
      return `[${status}] ${t.name} (${t.schedule_type}: ${t.schedule}) -> tab:${t.tab_name}`;
    }).join('\n');
    return { handled: true, response: `Tasks:\n${taskList}` };
  }

  // /cost
  if (text === '/cost' || text.startsWith('/cost ')) {
    const { getCostSummary, formatCostSummary } = await import('../observability/analytics.js');
    return { handled: true, response: formatCostSummary(getCostSummary()) };
  }

  // /activity [hours]
  if (text === '/activity' || text.startsWith('/activity ')) {
    const hours = parseInt(text.slice(10).trim()) || 24;
    const { getActivitySummary, formatActivitySummary } = await import('../observability/analytics.js');
    return { handled: true, response: formatActivitySummary(getActivitySummary(hours)) };
  }

  // /handoff [tab]
  if (text.startsWith('/handoff')) {
    const tabName = text.slice(9).trim() || 'default';
    const { exportTab, formatHandoffInfo } = await import('../cli/handoff.js');
    const info = exportTab(tabName);
    if (!info) return { handled: true, response: `Tab "${tabName}" not found.` };
    return { handled: true, response: formatHandoffInfo(info) };
  }

  // /machines
  if (text === '/machines' || text.startsWith('/machines@')) {
    const { listMachines } = await import('../machines/index.js');
    const machines = listMachines();
    if (machines.length === 0) return { handled: true, response: 'No machines registered.' };
    const list = machines.map(m => {
      const primary = m.isPrimary ? ' ⭐' : '';
      const remote = m.host ? ` (${m.sshUser}@${m.host})` : ' (local)';
      const paths = m.projectPaths.slice(0, 3).join(', ');
      return `• ${m.name}${primary}${remote}\n  Projects: ${paths}`;
    }).join('\n\n');
    return { handled: true, response: `🖥 ${machines.length} machine(s):\n\n${list}` };
  }

  // /projects
  if (text === '/projects' || text.startsWith('/projects@')) {
    const { listProjects } = await import('../projects/index.js');
    const projects = listProjects();
    if (projects.length === 0) return { handled: true, response: 'No projects found. Create one with /newproject <name>' };
    const userProjects = projects.filter((p): p is Project => p.type === 'user-project');
    const categories = projects.filter((p): p is Project => p.type === 'category');
    let msg = '📦 Projects:\n';
    if (userProjects.length > 0) msg += userProjects.map((p) => `  • ${p.name} — ${p.path}`).join('\n');
    if (categories.length > 0) {
      msg += '\n\n📁 Categories:\n';
      msg += categories.map((p) => `  • ${p.name}`).join('\n');
    }
    return { handled: true, response: msg };
  }

  // /project <name>
  if (text.startsWith('/project ') && !text.startsWith('/projects')) {
    const name = text.slice(9).trim();
    const { getProject, setUserContext } = await import('../projects/index.js');
    const project = getProject(name);
    if (!project) return { handled: true, response: `Project "${name}" not found. Use /projects to list or /newproject to create.` };
    setUserContext(userId, project.name, project.name);
    return { handled: true, response: `Switched to project: ${project.name}\nPath: ${project.path}\n\nNext messages will work in this project.` };
  }

  // /newproject <name> [path]
  if (text.startsWith('/newproject ')) {
    const parts = text.slice(12).trim().split(/\s+/);
    const name = parts[0];
    const customPath = parts[1] || undefined;
    if (!name) return { handled: true, response: 'Usage: /newproject <name> [path]' };
    const { createProject, setUserContext } = await import('../projects/index.js');
    const project = createProject(name, customPath);
    setUserContext(userId, project.name, project.name);
    return { handled: true, response: `✓ Project "${name}" created at ${project.path}\nSwitched to this project.` };
  }

  // /close <tab>
  if (text.startsWith('/close ')) {
    const tabNameToClose = text.slice(7).trim();
    if (!tabNameToClose) return { handled: true, response: 'Usage: /close <tabname>' };
    // Stop any running subprocess before deleting records
    tabManager.stopTab(tabNameToClose);
    const { closeTab } = await import('../projects/index.js');
    const closed = closeTab(tabNameToClose);
    return { handled: true, response: closed ? `Tab "${tabNameToClose}" permanently closed. History deleted.` : `Tab "${tabNameToClose}" not found.` };
  }

  // /fresh <project>
  if (text.startsWith('/fresh ')) {
    const projectName = text.slice(7).trim();
    const { getProject, setUserContext } = await import('../projects/index.js');
    const project = getProject(projectName);
    if (!project) return { handled: true, response: `Project "${projectName}" not found.` };
    const freshTabName = `${projectName}-${Date.now().toString(36).slice(-4)}`;
    setUserContext(userId, project.name, freshTabName);
    return { handled: true, response: `Fresh start in "${projectName}" (tab: ${freshTabName})\nSend your message now.` };
  }

  return { handled: false };
}

/**
 * Shared project routing logic — resolves which tab/project to use for a message.
 * Extracted from the identical blocks in Telegram, WhatsApp, and Discord channels.
 */
export async function resolveProjectRoute(
  rawPrompt: string,
  tabName: string,
  text: string,
  userId: string,
): Promise<RouteResult> {
  if (tabName !== 'default' || text.startsWith('/tab ')) {
    return { effectiveTabName: tabName };
  }

  try {
    const { routeMessage, setUserContext, listProjects } = await import('../projects/index.js');
    const decision = routeMessage(rawPrompt, { userId });

    if (decision.needsConfirmation) {
      const projects = listProjects().filter((p): p is Project => p.type === 'user-project');
      const options = projects.map((p, i: number) => `${i + 1}) ${p.name}`).join('\n');
      return {
        effectiveTabName: tabName,
        confirmationMessage: `Which project?\n${options}\n\nReply with the number, or just send your message with /project <name> first.`,
      };
    }

    setUserContext(userId, decision.project.name, decision.tabName);
    return {
      effectiveTabName: decision.tabName,
      projectPath: decision.project.path,
    };
  } catch {
    return { effectiveTabName: tabName };
  }
}
