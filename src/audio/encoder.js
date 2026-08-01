/**
 * TX Audio Engine — frame assembly and playback.
 *
 * All frequency scheduling is done against the AudioContext clock
 * (ctx.currentTime), not setTimeout — this gives sample-accurate
 * symbol timing that never drifts.
 *
 * Frame structure (see docs/SPEC.md):
 *   WAKE → APP_SIG×2 → SYNC → SENDER_UUID → RECIPIENT_UUID →
 *   LENGTH(16) → DATA_K(8) → RS_PAYLOAD → END
 *
 * RS_PAYLOAD = rsEncode(pack(huffman(text)), RS_NSYM)
 * DATA_K = number of Huffman bytes before RS parity
 */

import { encode as huffmanEncode, encodedBitLength } from './huffman.js';
import { rsEncode } from './rs.js';
import { getShortUUID } from '../storage/store.js';

// ---------------------------------------------------------------------------
// Protocol constants — must match decoder exactly
// ---------------------------------------------------------------------------

const SAMPLE_RATE       = 44100;
const SYMBOL_S          = 0.080;
const WAKE_S            = 0.500;
const END_S             = 0.300;
const SCHEDULE_OFFSET_S = 0.050;

const LOW_FREQS  = [4000, 4500, 5000, 5500];
const HIGH_FREQS = [6000, 6500, 7000, 7500];
const WAKE_LOW   = 3000;
const WAKE_HIGH  = 8500;

const APP_SIG    = 0xA3D7F1;
const BROADCAST  = 0xFFFFFFFF;

// Reed-Solomon parity symbols — corrects up to RS_NSYM/2 byte errors.
// With RS_NSYM=8: corrects up to 4 corrupted bytes per frame.
// Room echoes at 80ms/symbol typically corrupt 1-3 symbols = 1-2 bytes —
// well within correction capability. No copies needed.
export const RS_NSYM = 8;

const APP_SIG_BITS     = toBits(APP_SIG, 24);
const APP_SIG_REPEATED = [...APP_SIG_BITS, ...APP_SIG_BITS]; // 48 bits
const BROADCAST_BITS   = new Array(32).fill(1);
const SYNC_BITS        = [0,1,0,1,0,1, 0,1,0,1,0,1, 0,1,0,1,0,1]; // 18 bits

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_RE = /^[A-Za-z0-9 .,!?'"()\-:;/@#_\n]+$/;
const MAX_CHARS  = 280;

export function validateMessage(text) {
  if (!text.length)            return { valid: false, error: 'Message cannot be empty' };
  if (text.length > MAX_CHARS) return { valid: false, error: `Max ${MAX_CHARS} characters` };
  if (!ALLOWED_RE.test(text))  return { valid: false, error: 'Only English characters and basic punctuation allowed' };
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
 * @param {string}      text          - Message to send
 * @param {string|null} recipientUUID - 8-char hex UUID or null for broadcast
 * @param {object}      hooks         - Optional { onStart, onEnd } callbacks for
 *                                      muting the RX pipeline during TX
 * @returns {Promise<void>}
 */
export async function transmit(text, recipientUUID = null, hooks = {}) {
  const { valid, error } = validateMessage(text);
  if (!valid) throw new Error(error);
  if (isTransmitting) throw new Error('Already transmitting');

  isTransmitting = true;
  hooks.onStart?.();
  console.log('[encoder] sending:', JSON.stringify(text));
  try {
    const dataBits = assembleFrame(text, recipientUUID);
    await playFrame(dataBits);
  } finally {
    isTransmitting = false;
    hooks.onEnd?.();
  }
}

/**
 * Estimate total transmission duration in milliseconds.
 */
export function estimateDuration(text) {
  const huffBits  = encodedBitLength(text);
  const k         = Math.ceil(huffBits / 8);         // data bytes
  const rsBits    = (k + RS_NSYM) * 8;               // RS codeword in bits
  const totalBits =
    APP_SIG_REPEATED.length + // 48
    SYNC_BITS.length         + // 18
    32                       + // SENDER_UUID
    32                       + // RECIPIENT_UUID
    16                       + // LENGTH (charCount)
    8                        + // DATA_K
    rsBits;

  const symbolCount = Math.ceil(totalBits / 4);
  return Math.ceil(symbolCount * SYMBOL_S * 1000 + (WAKE_S + END_S) * 1000);
}

// ---------------------------------------------------------------------------
// Frame assembly
// ---------------------------------------------------------------------------

/**
 * Build the complete data bit stream.
 * Exported for testing.
 */
export function assembleFrame(text, recipientUUID = null) {
  // Huffman encode → bits → pack to bytes
  const huffBits    = huffmanEncode(text);
  const k           = Math.ceil(huffBits.length / 8);
  const dataBytes   = new Uint8Array(k);
  for (let i = 0; i < huffBits.length; i++) {
    if (huffBits[i]) dataBytes[i >> 3] |= (1 << (7 - (i & 7)));
  }

  // RS encode
  const rsBytes = rsEncode(dataBytes, RS_NSYM);

  // Unpack RS codeword back to bits
  const rsBits = [];
  for (const byte of rsBytes) {
    for (let b = 7; b >= 0; b--) rsBits.push((byte >> b) & 1);
  }

  const senderBits    = toBits(parseInt(getShortUUID(), 16), 32);
  const recipientBits = recipientUUID
    ? toBits(parseInt(recipientUUID, 16), 32)
    : BROADCAST_BITS;
  const lengthBits    = toBits(text.length, 16);
  const dataKBits     = toBits(k, 8);

  return [
    ...APP_SIG_REPEATED,
    ...SYNC_BITS,
    ...senderBits,
    ...recipientBits,
    ...lengthBits,
    ...dataKBits,
    ...rsBits,
  ];
}

// ---------------------------------------------------------------------------
// Audio playback
// ---------------------------------------------------------------------------

async function playFrame(dataBits) {
  const ctx = getCtx();
  await ctx.resume();

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value      = 6;
  compressor.ratio.value     = 8;
  compressor.attack.value    = 0.002;
  compressor.release.value   = 0.1;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(compressor);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type  = 'sine';
  osc2.type  = 'sine';

  const g1 = ctx.createGain(); g1.gain.value = 0.5;
  const g2 = ctx.createGain(); g2.gain.value = 0.5;
  osc1.connect(g1); g1.connect(master);
  osc2.connect(g2); g2.connect(master);

  let t = ctx.currentTime + SCHEDULE_OFFSET_S;
  const startTime = t;

  osc1.frequency.setValueAtTime(WAKE_LOW,  t);
  osc2.frequency.setValueAtTime(WAKE_HIGH, t);
  t += WAKE_S;

  for (const { lo, hi } of toSymbols(dataBits)) {
    osc1.frequency.setValueAtTime(LOW_FREQS[lo],  t);
    osc2.frequency.setValueAtTime(HIGH_FREQS[hi], t);
    t += SYMBOL_S;
  }

  osc1.frequency.setValueAtTime(WAKE_LOW,  t);
  osc2.frequency.setValueAtTime(WAKE_HIGH, t);
  t += END_S;

  osc1.start(startTime); osc2.start(startTime);
  osc1.stop(t);          osc2.stop(t);

  const durationMs = (t - ctx.currentTime) * 1000;
  return new Promise(resolve => setTimeout(resolve, durationMs + 100));
}

// ---------------------------------------------------------------------------
// Bit utilities
// ---------------------------------------------------------------------------

function toBits(n, width) {
  const bits = [];
  for (let i = width - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  return bits;
}

export function toSymbols(bits) {
  const padded = [...bits];
  while (padded.length % 4 !== 0) padded.push(0);
  const symbols = [];
  for (let i = 0; i < padded.length; i += 4) {
    symbols.push({ lo: (padded[i] << 1) | padded[i+1], hi: (padded[i+2] << 1) | padded[i+3] });
  }
  return symbols;
}
