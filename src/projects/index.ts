export type { Project, RouteDecision, RoutingContext } from './types.js';
export { discoverProjects, createProject, listProjects, getProject, ensureCategory, touchProject, closeTab, getWorkspaceRoot, getManagedWorkspace } from './manager.js';
export { routeMessage, setUserContext } from './router.js';
