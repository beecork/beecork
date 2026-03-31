export type { KnowledgeEntry, KnowledgeScope } from './types.js';
export {
  getGlobalKnowledge, addGlobalKnowledge,
  getProjectKnowledge, addProjectKnowledge,
  getTabKnowledge, getAllKnowledge,
  formatKnowledgeForContext, addKnowledge, searchKnowledge,
} from './manager.js';
