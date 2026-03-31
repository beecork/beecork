import { saveMedia } from '../store.js';
import { logger } from '../../util/logger.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class SunoGenerator implements MediaGenerator {
  readonly id = 'suno';
  readonly name = 'Suno AI Music';
  readonly supportedTypes: MediaType[] = ['music'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'music') throw new Error('Suno only supports music generation');

    const response = await fetch('https://studio-api.suno.ai/api/external/generate/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        topic: prompt.slice(0, 200),
        tags: options?.style || 'pop',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Suno error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { id: string; audio_url?: string };

    // Poll for completion (Suno takes time)
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusResp = await fetch(`https://studio-api.suno.ai/api/external/clips/?ids=${data.id}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!statusResp.ok) continue;
      const clips = await statusResp.json() as Array<{ status: string; audio_url?: string }>;
      if (clips[0]?.status === 'complete' && clips[0]?.audio_url) {
        const audioResp = await fetch(clips[0].audio_url, { signal: AbortSignal.timeout(60000) });
        const buffer = Buffer.from(await audioResp.arrayBuffer());
        const filePath = saveMedia(buffer, 'mp3', 'generated-music.mp3');
        return { filePath, mimeType: 'audio/mpeg' };
      }
    }
    throw new Error('Suno music generation timed out');
  }
}
