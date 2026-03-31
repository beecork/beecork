export type EventType = 'task_started' | 'task_completed' | 'task_failed' | 'watcher_triggered' | 'media_generated' | 'delegation_completed' | 'user_command' | 'system_event';

export interface ActivityEvent {
  id: string;
  eventType: EventType;
  projectName: string | null;
  tabName: string | null;
  summary: string;
  details: string | null;
  durationMs: number | null;
  costUsd: number | null;
  createdAt: string;
}
