export interface Project {
  id: string;
  name: string;
  path: string;
  type: 'user-project' | 'category';
  lastUsedAt: string;
  createdAt: string;
}

export interface RouteDecision {
  project: Project;
  tabName: string;
  isNewTab: boolean;
  confidence: number;
  needsConfirmation: boolean;
  reason: string;
}

export interface RoutingContext {
  userId?: string;
}
