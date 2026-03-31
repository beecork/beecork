import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class NanoBananaGenerator implements MediaGenerator {
  readonly id = 'nano-banana';
  readonly name = 'Google Nano Banana';
  readonly supportedTypes: MediaType[] = ['image'];

  constructor(private apiKey: string, private model: string = 'gemini-2.5-flash-image') {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'image') throw new Error('Nano Banana only supports image generation');

    // Gemini image generation API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt.slice(0, 2000) }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageGenerationConfig: {
              numberOfImages: 1,
            },
          },
        }),
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Nano Banana error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const imagePart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!imagePart?.inlineData?.data) {
      throw new Error('Nano Banana returned no image data');
    }
    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    const ext = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const filePath = saveMedia(buffer, ext, `generated-image.${ext}`);
    return { filePath, mimeType };
  }
}
