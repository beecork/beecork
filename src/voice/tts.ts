import { logger } from '../util/logger.js';
import { saveMedia } from '../media/store.js';

export interface TTSProvider {
  synthesize(text: string): Promise<string>; // Returns path to audio file
}

/** OpenAI TTS API provider */
export class OpenAITTSProvider implements TTSProvider {
  constructor(private apiKey: string, private voice: string = 'alloy') {}

  async synthesize(text: string): Promise<string> {
    // Truncate very long text (TTS has limits)
    const truncated = text.slice(0, 4096);

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: truncated,
        voice: this.voice,
        response_format: 'opus',
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`TTS API error: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return saveMedia(buffer, 'ogg', 'voice-reply.ogg');
  }
}

/** ElevenLabs TTS provider */
export class ElevenLabsTTSProvider implements TTSProvider {
  constructor(private apiKey: string, private voiceId: string = '21m00Tcm4TlvDq8ikWAM') {}

  async synthesize(text: string): Promise<string> {
    const truncated = text.slice(0, 5000);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: truncated,
        model_id: 'eleven_monolingual_v1',
        output_format: 'mp3_44100_128',
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return saveMedia(buffer, 'mp3', 'voice-reply.mp3');
  }
}

/** Create TTS provider from config */
export function createTTSProvider(config: { provider: string; apiKey?: string; voice?: string }): TTSProvider | null {
  switch (config.provider) {
    case 'openai':
      if (!config.apiKey) {
        logger.warn('OpenAI API key not configured for TTS');
        return null;
      }
      return new OpenAITTSProvider(config.apiKey, config.voice);
    case 'elevenlabs':
      if (!config.apiKey) {
        logger.warn('ElevenLabs API key not configured for TTS');
        return null;
      }
      return new ElevenLabsTTSProvider(config.apiKey, config.voice);
    default:
      logger.warn(`Unknown TTS provider: ${config.provider}`);
      return null;
  }
}
