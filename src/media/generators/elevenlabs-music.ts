import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class ElevenLabsMusicGenerator implements MediaGenerator {
  readonly id = 'elevenlabs-music';
  readonly name = 'ElevenLabs Music';
  readonly supportedTypes: MediaType[] = ['music'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'music') throw new Error('ElevenLabs Music only supports music generation');

    const response = await fetch('https://api.elevenlabs.io/v1/music/generate', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 1000),
        duration_seconds: options?.duration || 30,
        ...(options?.style ? { tags: options.style } : {}),
      }),
      signal: AbortSignal.timeout(180000), // 3 min — music generation takes time
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs Music error ${response.status}: ${err.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = saveMedia(buffer, 'mp3', 'generated-music.mp3');
    return { filePath, mimeType: 'audio/mpeg' };
  }
}
