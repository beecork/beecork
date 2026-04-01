import { saveMedia } from '../store.js';
import { pollForCompletion } from './poll-util.js';
import type { MediaGenerator, MediaType, GenerateOptions, GenerateResult } from '../types.js';

interface RunwayStatusResponse {
  status: string;
  output?: string[];
}

export class RunwayGenerator implements MediaGenerator {
  readonly id = 'runway';
  readonly name = 'Runway Gen-3';
  readonly supportedTypes: MediaType[] = ['video'];

  constructor(private apiKey: string) {}

  async generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult> {
    if (type !== 'video') throw new Error('Runway only supports video generation');

    // Start generation
    const startResponse = await fetch('https://api.runwayml.com/v1/image_to_video', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        model: 'gen3a_turbo',
        promptText: prompt.slice(0, 2000),
        duration: options?.duration || 5,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!startResponse.ok) {
      const err = await startResponse.text();
      throw new Error(`Runway error ${startResponse.status}: ${err.slice(0, 200)}`);
    }

    const { id: taskId } = await startResponse.json() as { id: string };

    // Poll for completion (max 5 minutes)
    const headers = { 'Authorization': `Bearer ${this.apiKey}`, 'X-Runway-Version': '2024-11-06' };
    const videoUrl = await pollForCompletion<RunwayStatusResponse>({
      statusUrl: `https://api.runwayml.com/v1/tasks/${taskId}`,
      headers,
      isComplete: (data) => data.status === 'SUCCEEDED' && !!data.output?.[0],
      isFailed: (data) => data.status === 'FAILED' ? 'generation failed' : null,
      getResultUrl: (data) => data.output![0],
      label: 'Runway',
    });

    const videoResponse = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
    const buffer = Buffer.from(await videoResponse.arrayBuffer());
    const filePath = saveMedia(buffer, 'mp4', 'generated-video.mp4');
    return { filePath, mimeType: 'video/mp4', durationMs: (options?.duration || 5) * 1000 };
  }
}
