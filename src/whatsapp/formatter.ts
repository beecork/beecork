import { chunkText } from '../util/text.js';

const WHATSAPP_MAX_LENGTH = 8192;

/** Chunk text for WhatsApp's larger message limit */
export function chunkTextWA(text: string): string[] {
  return chunkText(text, WHATSAPP_MAX_LENGTH);
}
