export type MediaType = 'image' | 'video' | 'audio' | 'music';

export interface GenerateOptions {
  style?: string;
  model?: string;
  width?: number;
  height?: number;
  duration?: number;
  format?: string;
}

export interface GenerateResult {
  filePath: string;
  mimeType: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface MediaGenerator {
  readonly id: string;
  readonly name: string;
  readonly supportedTypes: MediaType[];
  generate(type: MediaType, prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
}
