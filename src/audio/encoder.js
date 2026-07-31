/**
 * TX Audio Engine — frame assembly and playback.
 *
 * All frequency scheduling is done against the AudioContext clock
 * (ctx.currentTime), not setTimeout — this gives sample-accurate
 * symbol timing that never drifts.
 *
 * Frame structure (see docs/SPEC.md):
 *   WAKE → APP_SIG → SYNC → SENDER_UUID → RECIPIENT_UUID →
 *   NUM_COPIES → LENGTH → PAYLOAD_1 → CRC16_1 → PAYLOAD_2 → CRC16_2 → END
 */

import { encode as huffmanEncode, encodedBitLength } from './huffman.js';
import { crc16 } from './crc.js';
import { getShortUUID } from '../storage/store.js';

// ---------------------------------------------------------------------------
// Protocol constants — must match decoder exactly
// ---------------------------------------------------------------------------

const SAMPLE_RATE       = 44100;
const SYMBOL_S          = 0.020; // 20ms per symbol
const WAKE_S            = 0.500; // 500ms sustained tones
const END_S             = 0.300; // 300ms sustained tones
const SCHEDULE_OFFSET_S = 0.050; // 50ms ahead of current time for scheduling

// 8 tones per sub-band, 250 Hz spacing
const LOW_FREQS  = [16000, 16250, 16500, 16750, 17000, 17250, 17500, 17750];
const HIGH_FREQS = [18000, 18250, 18500, 18750, 19000, 19250, 19500, 19750];

const WAKE_LOW  = 17000; // centre of low sub-band  (for WAKE + END signals)
const WAKE_HIGH = 19000; // centre of high sub-band

// Protocol fixed values
const APP_SIG    = 0xA3D7F1;   // 24-bit app fingerprint — see SPEC.md
const BROADCAST  = 0xFFFFFFFF; // RECIPIENT_UUID for broadcast mode
const NUM_COPIES = 2;          // payload transmitted twice for redundancy

// Pre-computed constant bit sequences (computed once at module load)
const APP_SIG_BITS    = toBits(APP_SIG, 24);
const BROADCAST_BITS  = new Array(32).fill(1);
const NUM_COPIES_BITS = toBits(NUM_COPIES, 8);

// SYNC: alternating 010101... gives guaranteed transitions in both sub-bands,
// helping the receiver lock onto symbol boundaries before data arrives.
const SYNC_BITS = [0,1,0,1,0,1, 0,1,0,1,0,1, 0,1,0,1,0,1]; // 18 bits = 3 symbols

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_RE = /^[A-Za-z0-9 .,!?'"()\-:;/@#_\n]+$/;
const MAX_CHARS  = 280;

/**
 * Validate message text before transmission.
 * @param {string} text
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateMessage(text) {
  if (!text.length)              return { valid: false, error: 'Message cannot be empty' };
  if (text.length > MAX_CHARS)   return { valid: false, error: `Max ${MAX_CHARS} characters` };
  if (!ALLOWED_RE.test(text))    return { valid: false, error: 'Only English characters and basic punctuation allowed' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Transmission state
// ---------------------------------------------------------------------------

export let isTransmitting = false;
let _audioCtx = null;

function getCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  return _audioCtx;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Transmit a message over the device speaker.
 *
 * Must be called from a user-gesture handler (tap/click) to satisfy
 * browser AudioContext autoplay policy on iOS Safari and Android Chrome.
 *
 * @param {string} text - Message to send (validated internally)
 * @param {string|null} recipientUUID - 8-char hex short UUID, or null for broadcast
 * @returns {Promise<void>} Resolves when transmission is complete
 */
export async function transmit(text, recipientUUID = null) {
  const { valid, error } = validateMessage(text);
  if (!valid) throw new Error(error);
  if (isTransmitting) throw new Error('Already transmitting — wait for current message to finish');

  isTransmitting = true;
  try {
    const dataBits = assembleFrame(text, recipientUUID);
    await playFrame(dataBits);
  } finally {
    isTransmitting = false;
  }
}

/**
 * Estimate total transmission duration in milliseconds.
 * Use this to show a progress bar or countdown in the UI before sending.
 *
 * @param {string} text
 * @returns {number} Duration in ms
 */
export function estimateDuration(text) {
  const payloadBits = encodedBitLength(text);
  const totalDataBits =
    APP_SIG_BITS.length  + // 24
    SYNC_BITS.length     + // 18
    32                   + // SENDER_UUID
    32                   + // RECIPIENT_UUID
    NUM_COPIES_BITS.length + // 8
    16                   + // LENGTH
    (payloadBits + 16) * NUM_COPIES; // (payload + CRC-16) × 2

  const symbolCount = Math.ceil(totalDataBits / 6);
  const dataMs      = symbolCount * (SYMBOL_S * 1000);
  const overheadMs  = (WAKE_S + END_S) * 1000;
  return Math.ceil(dataMs + overheadMs);
}

// ---------------------------------------------------------------------------
// Frame assembly
// ---------------------------------------------------------------------------

/**
 * Build the complete data bit stream for the frame.
 * WAKE and END tones are handled separately in playFrame().
 * Exported for testing.
 */
export function assembleFrame(text, recipientUUID = null) {
  const payloadBits   = huffmanEncode(text);
  const crcBits       = toBits(crc16(payloadBits), 16);
  const senderBits    = toBits(parseInt(getShortUUID(), 16), 32);
  const recipientBits = recipientUUID
    ? toBits(parseInt(recipientUUID, 16), 32)
    : BROADCAST_BITS;
  const lengthBits    = toBits(text.length, 16);

  return [
    ...APP_SIG_BITS,
    ...SYNC_BITS,
    ...senderBits,
    ...recipientBits,
    ...NUM_COPIES_BITS,
    ...lengthBits,
    ...payloadBits, ...crcBits,  // copy 1
    ...payloadBits, ...crcBits,  // copy 2
  ];
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

async function playFrame(dataBits) {
  const ctx = getCtx();
  await ctx.resume(); // required after user gesture on iOS/Android

  // Signal chain: osc → gain (0.5 each) → masterGain → speakers
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'sine';
  osc2.type = 'sine';

  const g1 = ctx.createGain(); g1.gain.value = 0.5;
  const g2 = ctx.createGain(); g2.gain.value = 0.5;

  osc1.connect(g1); g1.connect(master);
  osc2.connect(g2); g2.connect(master);

  // Schedule all frequency changes against the audio clock
  let t = ctx.currentTime + SCHEDULE_OFFSET_S;
  const startTime = t;

  // WAKE — sustained tones at sub-band centres
  osc1.frequency.setValueAtTime(WAKE_LOW,  t);
  osc2.frequency.setValueAtTime(WAKE_HIGH, t);
  t += WAKE_S;

  // Data symbols
  const symbols = toSymbols(dataBits);
  for (const { lo, hi } of symbols) {
    osc1.frequency.setValueAtTime(LOW_FREQS[lo],  t);
    osc2.frequency.setValueAtTime(HIGH_FREQS[hi], t);
    t += SYMBOL_S;
  }

  // END — sustained tones at sub-band centres (shorter than WAKE)
  osc1.frequency.setValueAtTime(WAKE_LOW,  t);
  osc2.frequency.setValueAtTime(WAKE_HIGH, t);
  t += END_S;

  osc1.start(startTime);
  osc2.start(startTime);
  osc1.stop(t);
  osc2.stop(t);

  // Resolve ~100ms after transmission completes
  const durationMs = (t - ctx.currentTime) * 1000;
  return new Promise(resolve => setTimeout(resolve, durationMs + 100));
}

// ---------------------------------------------------------------------------
// Bit utilities
// ---------------------------------------------------------------------------

/** Convert an integer to an array of bits (MSB first). */
function toBits(n, width) {
  const bits = [];
  for (let i = width - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  return bits;
}

/**
 * Convert a flat bit array into dual-band symbol pairs.
 * Every 6 bits → one symbol: first 3 bits = low band index, next 3 = high band index.
 * Pads with zeros to the nearest multiple of 6.
 * Exported for testing.
 */
export function toSymbols(bits) {
  const padded = [...bits];
  while (padded.length % 6 !== 0) padded.push(0);

  const symbols = [];
  for (let i = 0; i < padded.length; i += 6) {
    const lo = (padded[i]   << 2) | (padded[i+1] << 1) | padded[i+2];
    const hi = (padded[i+3] << 2) | (padded[i+4] << 1) | padded[i+5];
    symbols.push({ lo, hi });
  }
  return symbols;
}
