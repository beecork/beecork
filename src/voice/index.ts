export { createSTTProvider, type STTProvider } from './stt.js';
export { createTTSProvider, type TTSProvider } from './tts.js';

import { createSTTProvider, type STTProvider } from './stt.js';
import { createTTSProvider, type TTSProvider } from './tts.js';
import type { VoiceConfig } from '../types.js';
import { logger } from '../util/logger.js';

export function initVoiceProviders(voice?: VoiceConfig): { stt: STTProvider | null; tts: TTSProvider | null } {
  let stt: STTProvider | null = null;
  let tts: TTSProvider | null = null;
  if (voice?.sttProvider && voice.sttProvider !== 'none') {
    stt = createSTTProvider({ provider: voice.sttProvider, apiKey: voice.sttApiKey });
  }
  if (voice?.ttsProvider && voice.ttsProvider !== 'none') {
    tts = createTTSProvider({ provider: voice.ttsProvider, apiKey: voice.ttsApiKey, voice: voice.ttsVoice });
  }
  return { stt, tts };
}

export async function transcribeVoiceMessages(
  media: Array<{ type: string; filePath?: string; caption?: string }>,
  sttProvider: { transcribe(path: string): Promise<string>; warmup?(): void },
  channelId: string,
  warmedUp: boolean
): Promise<boolean> {
  if (!sttProvider) return warmedUp;
  if (!warmedUp) {
    sttProvider.warmup?.();
    warmedUp = true;
  }
  for (const m of media) {
    if (m.type === 'voice' && m.filePath) {
      const start = Date.now();
      try {
        const transcription = await sttProvider.transcribe(m.filePath);
        m.caption = `[Transcribed from voice message]: ${transcription}`;
        logger.info(`[${channelId}] Voice transcription: ${Date.now() - start}ms`);
      } catch (err) {
        logger.warn('Voice transcription failed, passing file path instead:', err);
      }
    }
  }
  return warmedUp;
}
