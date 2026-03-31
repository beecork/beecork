import fs from 'node:fs';
import { logger } from '../util/logger.js';

export interface STTProvider {
  transcribe(filePath: string): Promise<string>;
  warmup?(): Promise<void>;
}

/** OpenAI Whisper API provider */
export class WhisperAPIProvider implements STTProvider {
  constructor(private apiKey: string) {}

  async warmup(): Promise<void> {
    try {
      // Make a lightweight request to warm up the HTTPS connection
      await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch { /* non-critical */ }
  }

  async transcribe(filePath: string): Promise<string> {
    const formData = new FormData();
    formData.append('file', new Blob([fs.readFileSync(filePath)]), 'audio.ogg');
    formData.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Whisper API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json() as { text: string };
    return result.text;
  }
}

/** Create STT provider from config */
export function createSTTProvider(config: { provider: string; apiKey?: string }): STTProvider | null {
  switch (config.provider) {
    case 'whisper-api':
      if (!config.apiKey) {
        logger.warn('Whisper API key not configured, voice transcription disabled');
        return null;
      }
      return new WhisperAPIProvider(config.apiKey);
    default:
      logger.warn(`Unknown STT provider: ${config.provider}`);
      return null;
  }
}
