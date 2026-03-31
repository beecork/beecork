export { createSTTProvider, type STTProvider } from './stt.js';
export { createTTSProvider, type TTSProvider } from './tts.js';

import { createSTTProvider, type STTProvider } from './stt.js';
import { createTTSProvider, type TTSProvider } from './tts.js';
import type { VoiceConfig } from '../types.js';

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
