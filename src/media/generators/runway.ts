import { saveMedia } from '../store.js';
import { logger } from '../../util/logger.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class RunwayGenerator implements MediaGenerator {
  readonly id = 'runway';
  readonly name = 'Runway Gen-3';
  readonly supportedTypes: MediaType[] = ['video'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'video') throw new Error('Runway only supports video generation');

    // Start generation
    const startResponse = await fetch('https://api.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        model: 'gen3a_turbo',
        promptText: prompt.slice(0, 2000),
        duration: options?.duration || 5,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!startResponse.ok) {
      const err = await startResponse.text();
      throw new Error(`Runway error ${startResponse.status}: ${err.slice(0, 200)}`);
    }

    const { id: taskId } = await startResponse.json() as { id: string };

    // Poll for completion (max 5 minutes)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));

      const statusResponse = await fetch(`https://api.runwayml.com/v1/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'X-Runway-Version': '2024-11-06' },
        signal: AbortSignal.timeout(10000),
      });

      if (!statusResponse.ok) continue;
      const status = await statusResponse.json() as { status: string; output?: string[] };

      if (status.status === 'SUCCEEDED' && status.output?.[0]) {
        const videoResponse = await fetch(status.output[0], { signal: AbortSignal.timeout(60000) });
        const buffer = Buffer.from(await videoResponse.arrayBuffer());
        const filePath = saveMedia(buffer, 'mp4', 'generated-video.mp4');
        return { filePath, mimeType: 'video/mp4', durationMs: (options?.duration || 5) * 1000 };
      }

      if (status.status === 'FAILED') {
        throw new Error('Runway video generation failed');
      }

      logger.debug(`Runway task ${taskId}: ${status.status}`);
    }

    throw new Error('Runway video generation timed out (5 minutes)');
  }
}
