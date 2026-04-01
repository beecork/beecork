export type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from './types.js';
export { createMediaGenerator } from './factory.js';
export { saveMedia, cleanupMedia, ensureMediaDir, getMediaDir, isOversized } from './store.js';

import { createMediaGenerator } from './factory.js';
import type { MediaGenerator } from './types.js';

export interface MediaGeneratorConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  style?: string;
}

export function initMediaGenerators(configs?: MediaGeneratorConfig[]): MediaGenerator[] {
  if (!configs || configs.length === 0) return [];
  return configs.map(c => createMediaGenerator(c)).filter((g): g is MediaGenerator => g !== null);
}
