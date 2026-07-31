import { encode as huffmanEncode } from './huffman.js';
import { crc16 } from './crc.js';
import { getShortUUID } from '../storage/store.js';

// Protocol constants — see docs/SPEC.md
const SAMPLE_RATE = 44100;
const SYMBOL_DURATION_MS = 20;
const SYMBOL_DURATION_S = SYMBOL_DURATION_MS / 1000;

const LOW_BAND_FREQS  = [16000, 16250, 16500, 16750, 17000, 17250, 17500, 17750]; // 8 tones
const HIGH_BAND_FREQS = [18000, 18250, 18500, 18750, 19000, 19250, 19500, 19750]; // 8 tones

const WAKE_FREQ_LOW  = 17000; // centre of low sub-band
const WAKE_FREQ_HIGH = 19000; // centre of high sub-band
const WAKE_DURATION_MS = 500;
const END_DURATION_MS  = 300;

const APP_SIG = 0xA3D7F1; // 24-bit protocol constant
const BROADCAST_UUID = 0xFFFFFFFF;
const NUM_COPIES = 2;

const ALLOWED_CHARS = /^[A-Za-z0-9 .,!?'"()\-:;/@#_\n]+$/;
const MAX_CHARS = 280;

/**
 * Validate message text against the allowed character set.
 * @param {string} text
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessage(text) {
  if (!text.length) return { valid: false, error: 'Message cannot be empty' };
  if (text.length > MAX_CHARS) return { valid: false, error: `Max ${MAX_CHARS} characters` };
  if (!ALLOWED_CHARS.test(text)) return { valid: false, error: 'Only English characters and basic punctuation allowed' };
  return { valid: true };
}

/**
 * Transmit a message over the speaker.
 * Assembles the full frame and plays it through the Web Audio API.
 *
 * @param {string} text - Validated message text
 * @param {string|null} recipientUUID - 8-char short UUID, or null for broadcast
 * @returns {Promise<void>} Resolves when transmission is complete
 */
export async function transmit(text, recipientUUID = null) {
  // TODO Phase 1: implement full frame assembly and playback
  // Frame: WAKE → APP_SIG → SYNC → SENDER_UUID → RECIPIENT_UUID → NUM_COPIES → LENGTH → PAYLOAD×2 → END
  throw new Error('Not implemented');
}
