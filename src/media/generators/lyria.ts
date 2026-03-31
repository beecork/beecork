import { saveMedia } from '../store.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class LyriaGenerator implements MediaGenerator {
  readonly id = 'lyria';
  readonly name = 'Google Lyria';
  readonly supportedTypes: MediaType[] = ['music'];

  constructor(private apiKey: string, private model: string = 'lyria-3-clip') {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'music') throw new Error('Lyria only supports music generation');

    const useProModel = (options?.duration && options.duration > 30) || this.model.includes('pro');
    const modelId = useProModel ? 'lyria-3-pro' : 'lyria-3-clip';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt.slice(0, 2000) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
          },
        }),
        signal: AbortSignal.timeout(300000), // 5 min for full songs
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Lyria error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as any;
    const audioPart = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
    if (!audioPart?.inlineData?.data) {
      throw new Error('Lyria returned no audio data');
    }
    const buffer = Buffer.from(audioPart.inlineData.data, 'base64');
    const filePath = saveMedia(buffer, 'mp3', 'generated-music.mp3');
    return { filePath, mimeType: 'audio/mpeg' };
  }
}
