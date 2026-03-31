import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class ElevenLabsSfxGenerator implements MediaGenerator {
  readonly id = 'elevenlabs-sfx';
  readonly name = 'ElevenLabs Sound Effects';
  readonly supportedTypes: MediaType[] = ['audio'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'audio') throw new Error('ElevenLabs SFX only supports audio generation');

    const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: prompt.slice(0, 500),
        duration_seconds: options?.duration,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`ElevenLabs SFX error ${response.status}: ${err.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = saveMedia(buffer, 'mp3', 'generated-sfx.mp3');
    return { filePath, mimeType: 'audio/mpeg' };
  }
}
