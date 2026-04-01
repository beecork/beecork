import { saveMedia } from '../store.js';
import { pollForCompletion } from './poll-util.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

export class KlingGenerator implements MediaGenerator {
  readonly id = 'kling';
  readonly name = 'Kling AI';
  readonly supportedTypes: MediaType[] = ['video'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'video') throw new Error('Kling only supports video generation');

    const response = await fetch('https://api.klingai.com/v1/videos/text2video', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 2500),
        duration: options?.duration || 5,
        model_name: 'kling-v1',
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Kling error ${response.status}: ${err.slice(0, 200)}`);
    }

    const { data } = await response.json() as { data: { task_id: string } };

    // Poll for completion
    const headers = { 'Authorization': `Bearer ${this.apiKey}` };
    const videoUrl = await pollForCompletion({
      statusUrl: `https://api.klingai.com/v1/videos/text2video/${data.task_id}`,
      headers,
      isComplete: (data) => data.data.task_status === 'succeed' && !!data.data.task_result?.videos[0],
      isFailed: (data) => data.data.task_status === 'failed' ? 'generation failed' : null,
      getResultUrl: (data) => data.data.task_result.videos[0].url,
      label: 'Kling',
    });

    const videoResp = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
    const buffer = Buffer.from(await videoResp.arrayBuffer());
    const filePath = saveMedia(buffer, 'mp4', 'generated-video.mp4');
    return { filePath, mimeType: 'video/mp4' };
  }
}
