import { saveMedia } from '../store.js';
import { logger } from '../../util/logger.js';
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
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const statusResp = await fetch(`https://api.klingai.com/v1/videos/text2video/${data.task_id}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!statusResp.ok) continue;
      const status = await statusResp.json() as { data: { task_status: string; task_result?: { videos: Array<{ url: string }> } } };
      if (status.data.task_status === 'succeed' && status.data.task_result?.videos[0]) {
        const videoResp = await fetch(status.data.task_result.videos[0].url, { signal: AbortSignal.timeout(60000) });
        const buffer = Buffer.from(await videoResp.arrayBuffer());
        const filePath = saveMedia(buffer, 'mp4', 'generated-video.mp4');
        return { filePath, mimeType: 'video/mp4' };
      }
      if (status.data.task_status === 'failed') throw new Error('Kling video generation failed');
    }
    throw new Error('Kling video generation timed out');
  }
}
