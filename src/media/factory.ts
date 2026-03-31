import { logger } from '../util/logger.js';
import type { MediaGenerator } from './types.js';
import { DalleGenerator } from './generators/dall-e.js';
import { StableDiffusionGenerator } from './generators/stable-diffusion.js';
import { RunwayGenerator } from './generators/runway.js';
import { VeoGenerator } from './generators/veo.js';
import { KlingGenerator } from './generators/kling.js';
import { SunoGenerator } from './generators/suno.js';
import { ElevenLabsSfxGenerator } from './generators/elevenlabs-sfx.js';

export function createMediaGenerator(config: { provider: string; apiKey?: string; model?: string }): MediaGenerator | null {
  if (!config.apiKey) {
    logger.warn(`Media generator ${config.provider}: missing API key`);
    return null;
  }
  switch (config.provider) {
    case 'dall-e': return new DalleGenerator(config.apiKey, config.model);
    case 'stable-diffusion': return new StableDiffusionGenerator(config.apiKey);
    case 'runway': return new RunwayGenerator(config.apiKey);
    case 'veo': return new VeoGenerator(config.apiKey);
    case 'kling': return new KlingGenerator(config.apiKey);
    case 'suno': return new SunoGenerator(config.apiKey);
    case 'elevenlabs-sfx': return new ElevenLabsSfxGenerator(config.apiKey);
    default:
      logger.warn(`Unknown media generator: ${config.provider}`);
      return null;
  }
}
