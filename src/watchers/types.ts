export interface Watcher {
  id: string;
  name: string;
  description: string | null;
  checkCommand: string;
  condition: string;
  action: 'notify' | 'fix' | 'delegate';
  actionDetails: string | null;
  schedule: string;
  lastCheckAt: string | null;
  lastTriggeredAt: string | null;
  triggerCount: number;
  enabled: boolean;
  createdAt: string;
}
