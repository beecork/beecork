import { saveMedia } from '../store.js';
import { logger } from '../../util/logger.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class VeoGenerator implements MediaGenerator {
  readonly id = 'veo';
  readonly name = 'Google Veo';
  readonly supportedTypes: MediaType[] = ['video'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'video') throw new Error('Veo only supports video generation');

    // Use Gemini API for Veo access
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/veo-2.0-generate-001:predict?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: prompt.slice(0, 2000) }],
        parameters: { sampleCount: 1, durationSeconds: options?.duration || 5 },
      }),
      signal: AbortSignal.timeout(300000), // 5 min timeout for video
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Veo error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { predictions: Array<{ bytesBase64Encoded: string }> };
    const buffer = Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    const filePath = saveMedia(buffer, 'mp4', 'generated-video.mp4');
    return { filePath, mimeType: 'video/mp4', durationMs: (options?.duration || 5) * 1000 };
  }
}
