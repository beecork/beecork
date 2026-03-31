import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class ImagenGenerator implements MediaGenerator {
  readonly id = 'imagen';
  readonly name = 'Google Imagen';
  readonly supportedTypes: MediaType[] = ['image'];

  constructor(private apiKey: string, private model: string = 'imagen-3.0-generate-002') {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'image') throw new Error('Imagen only supports image generation');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:predict?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: prompt.slice(0, 2000) }],
          parameters: {
            sampleCount: 1,
            aspectRatio: options?.width && options?.height ? `${options.width}:${options.height}` : '1:1',
          },
        }),
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Imagen error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { predictions: Array<{ bytesBase64Encoded: string }> };
    if (!data.predictions?.[0]?.bytesBase64Encoded) {
      throw new Error('Imagen returned no image data');
    }
    const buffer = Buffer.from(data.predictions[0].bytesBase64Encoded, 'base64');
    const filePath = saveMedia(buffer, 'png', 'generated-image.png');
    return { filePath, mimeType: 'image/png' };
  }
}
