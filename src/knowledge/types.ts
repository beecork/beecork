export type KnowledgeScope = 'global' | 'project' | 'tab';

export interface KnowledgeEntry {
  content: string;
  scope: KnowledgeScope;
  source: string; // filename for global/project, tab_name for tab
  category?: string; // people, preferences, routines, general (global only)
}
