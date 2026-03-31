export interface CapabilityPack {
  id: string;
  name: string;
  description: string;
  category: 'productivity' | 'development' | 'data' | 'web';
  mcpServer: {
    package: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  };
  requiresApiKey: boolean;
  apiKeyHint?: string;
  apiKeyEnvVar?: string;
  setupUrl?: string;
}

export interface EnabledCapability {
  packId: string;
  apiKey?: string;
  enabledAt: string;
}
