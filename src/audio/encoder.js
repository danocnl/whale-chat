/**
 * TX Audio Engine — frame assembly and playback.
 *
 * Frame structure (see docs/SPEC.md):
 *   WAKE → APP_SIG×2 → SYNC → RS_HEADER → RS_PAYLOAD → END
 *
 * RS_HEADER = rsEncode([sender(4) + recipient(4) + charCount(2) + dataK(1)], HEADER_NSYM)
 * RS_PAYLOAD = rsEncode(pack(huffman(text)), DATA_NSYM)
 *
 * Modulation: 4-band 4-FSK, 250 Hz tone spacing within 4–8 kHz.
 * 2 bits per band × 4 bands = 8 bits per symbol → 100 bps at 80 ms/symbol.
 * All data bands stay within the proven 4–8 kHz speaker/mic range.
 */

import { encode as huffmanEncode, encodedBitLength } from './huffman.js';
import { rsEncode } from './rs.js';
import { getShortUUID } from '../storage/store.js';

// ── Protocol constants ────────────────────────────────────────
const SAMPLE_RATE       = 44100;
const SYMBOL_S          = 0.080;
const WAKE_S            = 0.800; // increased from 0.500 — more reliable WAKE detection
const END_S             = 0.300;
const SCHEDULE_OFFSET_S = 0.050;

// 4-FSK, 4 simultaneous bands, all within 4–8 kHz (proven reliable on all phones).
// 250 Hz tone spacing → ~6 FFT bins apart at 1024-point FFT (43 Hz/bin) — clearly separable.
const BAND_A = [4000, 4250, 4500, 4750]; // 2 bits
const BAND_B = [5000, 5250, 5500, 5750]; // 2 bits
const BAND_C = [6000, 6250, 6500, 6750]; // 2 bits
const BAND_D = [7000, 7250, 7500, 7750]; // 2 bits  → 8 bits per symbol total

// WAKE tones sit outside all data bands with comfortable gaps.
const WAKE_LOW  = 3000; // 1000 Hz below BAND_A start
const WAKE_HIGH = 8500; // 750 Hz above BAND_D top

const APP_SIG   = 0xA3D7F1;
const BROADCAST = 0xFFFFFFFF;

// RS parameters — same correction capability for both header and payload.
// HEADER_NSYM = 8 → corrects up to 4 byte errors in the header (UUID, charCount, dataK).
// DATA_NSYM   = 8 → corrects up to 4 byte errors in the payload.
export const HEADER_NSYM    = 8;
export const DATA_NSYM      = 8;
export const HEADER_DATA_K  = 11; // sender(4)+recipient(4)+charCount(2)+dataK(1)

const APP_SIG_BITS     = toBits(APP_SIG, 24);
const APP_SIG_REPEATED = [...APP_SIG_BITS, ...APP_SIG_BITS]; // 48 bits
const BROADCAST_BITS   = new Array(32).fill(1);
const SYNC_BITS        = [0,1,0,1,0,1, 0,1,0,1,0,1, 0,1,0,1,0,1]; // 18 bits

// ── Validation ────────────────────────────────────────────────
const ALLOWED_RE = /^[A-Za-z0-9 .,!?'"()\-:;/@#_\n]+$/;
const MAX_CHARS  = 280;

export function validateMessage(text) {
  if (!text.length)            return { valid: false, error: 'Message cannot be empty' };
  if (text.length > MAX_CHARS) return { valid: false, error: `Max ${MAX_CHARS} characters` };
  if (!ALLOWED_RE.test(text))  return { valid: false, error: 'Only English characters and basic punctuation allowed' };
  return { valid: true };
}

// ── Transmission state ────────────────────────────────────────
export let isTransmitting = false;
let _audioCtx = null;

function getCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  }
  return _audioCtx;
}

// ── Public API ────────────────────────────────────────────────
export async function transmit(text, recipientUUID = null, hooks = {}) {
  const { valid, error } = validateMessage(text);
  if (!valid) throw new Error(error);
  if (isTransmitting) throw new Error('Already transmitting');

  isTransmitting = true;
  hooks.onStart?.();
  try {
    await playFrame(assembleFrame(text, recipientUUID));
  } finally {
    isTransmitting = false;
    hooks.onEnd?.();
  }
}

export function estimateDuration(text) {
  const huffBits  = encodedBitLength(text);
  const dataK     = Math.ceil(huffBits / 8);
  const totalBits =
    APP_SIG_REPEATED.length        + // 48
    SYNC_BITS.length               + // 18
    (HEADER_DATA_K + HEADER_NSYM) * 8 + // RS_HEADER bytes → bits
    (dataK + DATA_NSYM) * 8;        // RS_PAYLOAD bytes → bits
  const symbolCount = Math.ceil(totalBits / 8); // 8 bits per symbol (4 bands × 2 bits)
  return Math.ceil(symbolCount * SYMBOL_S * 1000 + (WAKE_S + END_S) * 1000);
}

// ── Frame assembly ────────────────────────────────────────────
export function assembleFrame(text, recipientUUID = null) {
  // ── Payload RS block ──────────────────────────────────────
  const huffBits  = huffmanEncode(text);
  const dataK     = Math.ceil(huffBits.length / 8);
  const dataBytes = new Uint8Array(dataK);
  for (let i = 0; i < huffBits.length; i++) {
    if (huffBits[i]) dataBytes[i >> 3] |= (1 << (7 - (i & 7)));
  }
  const rsPayload = rsEncode(dataBytes, DATA_NSYM);

  // ── Header RS block ───────────────────────────────────────
  const senderInt    = parseInt(getShortUUID(), 16);
  const recipientInt = recipientUUID ? parseInt(recipientUUID, 16) : BROADCAST;
  const header       = new Uint8Array(HEADER_DATA_K);
  header[0] = (senderInt >> 24) & 0xff; header[1] = (senderInt >> 16) & 0xff;
  header[2] = (senderInt >> 8)  & 0xff; header[3] =  senderInt        & 0xff;
  header[4] = (recipientInt >> 24) & 0xff; header[5] = (recipientInt >> 16) & 0xff;
  header[6] = (recipientInt >> 8)  & 0xff; header[7] =  recipientInt        & 0xff;
  header[8] = (text.length >> 8) & 0xff; header[9] = text.length & 0xff;
  header[10] = dataK;
  const rsHeader = rsEncode(header, HEADER_NSYM);

  return [
    ...APP_SIG_REPEATED,
    ...SYNC_BITS,
    ...bytesToBits(rsHeader),
    ...bytesToBits(rsPayload),
  ];
}

// ── Audio playback ────────────────────────────────────────────
async function playFrame(dataBits) {
  const ctx = getCtx();
  await ctx.resume();

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18; compressor.knee.value = 6;
  compressor.ratio.value = 8; compressor.attack.value = 0.002;
  compressor.release.value = 0.1;
  compressor.connect(ctx.destination);

  const master = ctx.createGain();
  master.gain.value = 1.0;
  master.connect(compressor);

  // 4 oscillators — one per band
  const oscs = [0,1,2,3].map(() => {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    g.gain.value = 0.25;
    osc.type = 'sine';
    osc.connect(g); g.connect(master);
    return { osc, g };
  });
  const [A, B, C, D] = oscs;

  let t = ctx.currentTime + SCHEDULE_OFFSET_S;
  const startTime = t;

  // WAKE — A and D carry the WAKE tones; B and C are silent
  A.osc.frequency.setValueAtTime(WAKE_LOW,  t);
  B.g.gain.setValueAtTime(0, t);
  C.g.gain.setValueAtTime(0, t);
  D.osc.frequency.setValueAtTime(WAKE_HIGH, t);
  t += WAKE_S;

  // Data symbols — all 4 bands active
  A.g.gain.setValueAtTime(0.25, t);
  B.g.gain.setValueAtTime(0.25, t);
  C.g.gain.setValueAtTime(0.25, t);
  D.g.gain.setValueAtTime(0.25, t);
  for (const { a, b, c, d } of toSymbols(dataBits)) {
    A.osc.frequency.setValueAtTime(BAND_A[a], t);
    B.osc.frequency.setValueAtTime(BAND_B[b], t);
    C.osc.frequency.setValueAtTime(BAND_C[c], t);
    D.osc.frequency.setValueAtTime(BAND_D[d], t);
    t += SYMBOL_S;
  }

  // END — same as WAKE
  A.osc.frequency.setValueAtTime(WAKE_LOW,  t);
  B.g.gain.setValueAtTime(0, t);
  C.g.gain.setValueAtTime(0, t);
  D.osc.frequency.setValueAtTime(WAKE_HIGH, t);
  t += END_S;

  oscs.forEach(({ osc }) => { osc.start(startTime); osc.stop(t); });

  const durationMs = (t - ctx.currentTime) * 1000;
  return new Promise(resolve => setTimeout(resolve, durationMs + 100));
}

// ── Bit utilities ─────────────────────────────────────────────
function toBits(n, width) {
  const bits = [];
  for (let i = width - 1; i >= 0; i--) bits.push((n >>> i) & 1);
  return bits;
}

function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes)
    for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
  return bits;
}

/**
 * Convert a flat bit array into 4-band symbol quads.
 * Every 8 bits → one symbol: 2 bits per band (a, b, c, d).
 * Pads to the nearest multiple of 8.
 * Exported for testing.
 */
export function toSymbols(bits) {
  const padded = [...bits];
  while (padded.length % 8 !== 0) padded.push(0);
  const symbols = [];
  for (let i = 0; i < padded.length; i += 8) {
    symbols.push({
      a: (padded[i]   << 1) | padded[i+1],
      b: (padded[i+2] << 1) | padded[i+3],
      c: (padded[i+4] << 1) | padded[i+5],
      d: (padded[i+6] << 1) | padded[i+7],
    });
  }
  return symbols;
}
