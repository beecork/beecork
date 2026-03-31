import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class DalleGenerator implements MediaGenerator {
  readonly id = 'dall-e';
  readonly name = 'DALL-E (OpenAI)';
  readonly supportedTypes: MediaType[] = ['image'];

  constructor(private apiKey: string, private model: string = 'dall-e-3') {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'image') throw new Error('DALL-E only supports image generation');

    const size = options?.width && options?.height ? `${options.width}x${options.height}` : '1024x1024';
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt: prompt.slice(0, 4000),
        n: 1,
        size,
        quality: options?.style === 'hd' ? 'hd' : 'standard',
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DALL-E error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { data: Array<{ b64_json: string }> };
    const buffer = Buffer.from(data.data[0].b64_json, 'base64');
    const filePath = saveMedia(buffer, 'png', 'generated-image.png');
    return { filePath, mimeType: 'image/png' };
  }
}
