import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class RecraftGenerator implements MediaGenerator {
  readonly id = 'recraft';
  readonly name = 'Recraft (Images + Vectors)';
  readonly supportedTypes: MediaType[] = ['image']; // SVG vectors are still "images"

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'image') throw new Error('Recraft only supports image/vector generation');

    const isVector = options?.format === 'svg' || options?.style === 'vector';
    const endpoint = isVector
      ? 'https://external.api.recraft.ai/v1/images/generations'
      : 'https://external.api.recraft.ai/v1/images/generations';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 2000),
        model: isVector ? 'recraftv4' : 'recraftv4',
        response_format: isVector ? 'url' : 'b64_json',
        style: isVector ? 'vector_illustration' : (options?.style || 'realistic_image'),
        size: options?.width && options?.height ? `${options.width}x${options.height}` : '1024x1024',
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Recraft error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const image = data.data?.[0];

    if (isVector && image?.url) {
      // Download SVG from URL
      const svgResp = await fetch(image.url, { signal: AbortSignal.timeout(30000) });
      const svgBuffer = Buffer.from(await svgResp.arrayBuffer());
      const filePath = saveMedia(svgBuffer, 'svg', 'generated-vector.svg');
      return { filePath, mimeType: 'image/svg+xml' };
    } else if (image?.b64_json) {
      const buffer = Buffer.from(image.b64_json, 'base64');
      const filePath = saveMedia(buffer, 'png', 'generated-image.png');
      return { filePath, mimeType: 'image/png' };
    }

    throw new Error('Recraft returned no image data');
  }
}
