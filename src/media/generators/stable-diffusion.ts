import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class StableDiffusionGenerator implements MediaGenerator {
  readonly id = 'stable-diffusion';
  readonly name = 'Stable Diffusion (Stability AI)';
  readonly supportedTypes: MediaType[] = ['image'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'image') throw new Error('Stable Diffusion only supports image generation');

    const formData = new FormData();
    formData.append('prompt', prompt.slice(0, 10000));
    if (options?.style) formData.append('style_preset', options.style);
    formData.append('output_format', 'png');

    const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/core', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'image/*',
      },
      body: formData,
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Stability AI error ${response.status}: ${err.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filePath = saveMedia(buffer, 'png', 'generated-image.png');
    return { filePath, mimeType: 'image/png' };
  }
}
