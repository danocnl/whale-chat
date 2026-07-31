/**
 * RX Audio Engine — tone detection, state machine, frame parsing.
 *
 * Architecture: pure functions (testable in Node) + browser-only startListening().
 *
 * Pure exports: identifyToneIndex, isWakePresent, symbolsToBits,
 *               bitsToNum, parseHeader, decodePayload
 *
 * State machine (inside startListening):
 *   IDLE → WAKING (sustained WAKE tones) → RECEIVING (data symbols) → IDLE
 */

import { decodeWithLength } from './huffman.js';
import { verifyCRC } from './crc.js';
import { getShortUUID } from '../storage/store.js';

// ---------------------------------------------------------------------------
// Protocol constants — must match encoder exactly
// ---------------------------------------------------------------------------

const SAMPLE_RATE   = 44100;
const FFT_SIZE      = 4096;
const SYMBOL_MS     = 20;

const LOW_FREQS  = [16000, 16250, 16500, 16750, 17000, 17250, 17500, 17750];
const HIGH_FREQS = [18000, 18250, 18500, 18750, 19000, 19250, 19500, 19750];
const WAKE_LOW   = 17000;
const WAKE_HIGH  = 19000;
const APP_SIG    = 0xA3D7F1;
const BROADCAST  = 0xFFFFFFFF;

// Pre-compute FFT bin indices for all protocol frequencies
const freqToBin = f => Math.round(f * FFT_SIZE / SAMPLE_RATE);
const LOW_BINS      = LOW_FREQS.map(freqToBin);
const HIGH_BINS     = HIGH_FREQS.map(freqToBin);
const WAKE_LOW_BIN  = freqToBin(WAKE_LOW);
const WAKE_HIGH_BIN = freqToBin(WAKE_HIGH);

// Signal must be above this threshold to count as "present" (dBFS)
const SIGNAL_DB = -50;

// WAKE must be sustained for at least this many ticks (20ms each) = 400ms
const WAKE_MIN_TICKS = 20;

// Maximum data symbols to buffer before declaring a frame invalid
// 700 symbols × 6 bits = 4200 bits — enough for 2 × max payload + overhead
const MAX_FRAME_SYMBOLS = 700;

// Frame bit offsets (from start of buffer = start of APP_SIG)
const OFF = {
  APP_SIG_START:   0,
  APP_SIG_END:     24,
  SYNC_START:      24,
  SYNC_END:        42,
  SENDER_START:    42,
  SENDER_END:      74,
  RECIPIENT_START: 74,
  RECIPIENT_END:   106,
  COPIES_START:    106,
  COPIES_END:      114,
  LENGTH_START:    114,
  LENGTH_END:      130,
  DATA_START:      130,  // where payload copies begin
};

// ---------------------------------------------------------------------------
// Pure functions — exported for testing
// ---------------------------------------------------------------------------

/**
 * Given FFT magnitude data and an array of pre-computed bin indices,
 * return the index (0–7) of the tone with the highest energy.
 *
 * @param {Float32Array} fftData - from AnalyserNode.getFloatFrequencyData()
 * @param {number[]} bins - bin indices for the 8 tones in a sub-band
 * @returns {number} Tone index 0–7
 */
export function identifyToneIndex(fftData, bins) {
  let maxDb = -Infinity;
  let maxIdx = 0;
  for (let i = 0; i < bins.length; i++) {
    if (fftData[bins[i]] > maxDb) {
      maxDb = fftData[bins[i]];
      maxIdx = i;
    }
  }
  return maxIdx;
}

/**
 * Return true when both WAKE centre frequencies have signal above threshold.
 * Used to detect WAKE signal start and END signal.
 *
 * @param {Float32Array} fftData
 * @returns {boolean}
 */
export function isWakePresent(fftData) {
  return fftData[WAKE_LOW_BIN] > SIGNAL_DB &&
         fftData[WAKE_HIGH_BIN] > SIGNAL_DB;
}

/**
 * Convert an array of dual-band symbol pairs back to a flat bit array.
 * Inverse of encoder's toSymbols() — each {lo, hi} expands to 6 bits.
 *
 * @param {Array<{lo: number, hi: number}>} symbols
 * @returns {number[]}
 */
export function symbolsToBits(symbols) {
  const bits = [];
  for (const { lo, hi } of symbols) {
    bits.push((lo >> 2) & 1, (lo >> 1) & 1, lo & 1);
    bits.push((hi >> 2) & 1, (hi >> 1) & 1, hi & 1);
  }
  return bits;
}

/**
 * Extract an unsigned integer from a slice of the bit array.
 *
 * @param {number[]} bits
 * @param {number} start - Start index (inclusive)
 * @param {number} len   - Number of bits to read
 * @returns {number}
 */
export function bitsToNum(bits, start, len) {
  let n = 0;
  for (let i = 0; i < len; i++) n = (n << 1) | (bits[start + i] ?? 0);
  return n >>> 0;
}

/**
 * Parse all header fields from the frame bit buffer.
 * Buffer starts at APP_SIG (WAKE tones are not included).
 *
 * @param {number[]} bits
 * @returns {{ appSig, sender, recipient, numCopies, charCount }}
 */
export function parseHeader(bits) {
  const appSig    = bitsToNum(bits, OFF.APP_SIG_START, 24);
  const sender    = bitsToNum(bits, OFF.SENDER_START, 32)
                      .toString(16).padStart(8, '0');
  const recipient = bitsToNum(bits, OFF.RECIPIENT_START, 32);
  const numCopies = bitsToNum(bits, OFF.COPIES_START, 8);
  const charCount = bitsToNum(bits, OFF.LENGTH_START, 16);
  return { appSig, sender, recipient, numCopies, charCount };
}

/**
 * Decode the payload section after a user accepts an incoming message.
 * Handles CRC verification, fallback to the clean copy, and majority-bit voting.
 *
 * @param {number[]} frameBits - Full frame bit buffer (starting at APP_SIG)
 * @returns {{ text: string, crcStatus: 'clean'|'recovered'|'corrupted' }}
 */
export function decodePayload(frameBits) {
  const { numCopies, charCount } = parseHeader(frameBits);

  const copies = [];
  let offset = OFF.DATA_START;

  for (let i = 0; i < numCopies; i++) {
    const { text, bitsConsumed } = decodeWithLength(
      frameBits.slice(offset),
      charCount,
    );
    const rawBits  = frameBits.slice(offset, offset + bitsConsumed);
    const crcValue = bitsToNum(frameBits, offset + bitsConsumed, 16);
    const crcValid = verifyCRC(rawBits, crcValue);
    copies.push({ text, rawBits, crcValid });
    offset += bitsConsumed + 16;
  }

  // Both copies clean
  if (copies.every(c => c.crcValid)) {
    return { text: copies[0].text, crcStatus: 'clean' };
  }

  // One copy clean
  const clean = copies.find(c => c.crcValid);
  if (clean) return { text: clean.text, crcStatus: 'recovered' };

  // Both corrupted — majority-bit vote on raw payload bits, attempt decode
  const voted = majorityVote(copies.map(c => c.rawBits));
  try {
    const { text } = decodeWithLength(voted, charCount);
    return { text, crcStatus: 'corrupted' };
  } catch {
    return { text: copies[0]?.text ?? '', crcStatus: 'corrupted' };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function majorityVote(bitArrays) {
  const len = Math.max(...bitArrays.map(a => a.length));
  const half = bitArrays.length / 2;
  const result = [];
  for (let i = 0; i < len; i++) {
    const ones = bitArrays.reduce((sum, a) => sum + (a[i] ?? 0), 0);
    result.push(ones >= half ? 1 : 0);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Browser-only — getUserMedia + AnalyserNode + state machine
// ---------------------------------------------------------------------------

/**
 * Start listening for incoming transmissions.
 *
 * State machine: IDLE → WAKING → RECEIVING → IDLE
 *   IDLE:      Waiting for WAKE tones
 *   WAKING:    WAKE tones detected, counting duration
 *   RECEIVING: Collecting data symbols until END tones reappear
 *
 * CRITICAL: AGC, noise suppression, and echo cancellation must be disabled
 * or the FSK signal will be corrupted. See docs/SPEC.md.
 *
 * @param {function} onIncoming - Called with { senderUUID, isDirected, frameBits }
 * @returns {Promise<function>} Resolves with a stop() function
 */
export async function startListening(onIncoming) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl:  false,
      sampleRate:       SAMPLE_RATE,
    },
  });

  const ctx      = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source   = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize            = FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // no smoothing — we want instantaneous values
  source.connect(analyser);

  const fftData = new Float32Array(analyser.frequencyBinCount);

  let state     = 'IDLE';
  let wakeTicks = 0;
  let symbols   = [];

  function tick() {
    analyser.getFloatFrequencyData(fftData);
    const wakeNow = isWakePresent(fftData);

    switch (state) {
      case 'IDLE':
        if (wakeNow) { state = 'WAKING'; wakeTicks = 1; }
        break;

      case 'WAKING':
        if (wakeNow) {
          wakeTicks++;
        } else {
          if (wakeTicks >= WAKE_MIN_TICKS) {
            // WAKE confirmed — data is starting
            state   = 'RECEIVING';
            symbols = [];
          } else {
            // Too short — false positive, ignore
            state     = 'IDLE';
            wakeTicks = 0;
          }
        }
        break;

      case 'RECEIVING': {
        if (wakeNow) {
          // END signal detected
          if (symbols.length >= 24) { // minimum valid frame symbols
            processFrame(symbolsToBits(symbols));
          }
          state     = 'IDLE';
          wakeTicks = 0;
          symbols   = [];
        } else {
          const lo = identifyToneIndex(fftData, LOW_BINS);
          const hi = identifyToneIndex(fftData, HIGH_BINS);
          symbols.push({ lo, hi });

          if (symbols.length > MAX_FRAME_SYMBOLS) {
            // Frame too long — corrupted or runaway, abandon
            state   = 'IDLE';
            symbols = [];
          }
        }
        break;
      }
    }
  }

  function processFrame(frameBits) {
    const header = parseHeader(frameBits);

    if (header.appSig !== APP_SIG) return; // not our protocol

    const myUUID      = getShortUUID();
    const recipientHex = header.recipient.toString(16).padStart(8, '0');
    const isForMe     = header.recipient === BROADCAST || recipientHex === myUUID;

    if (!isForMe) return; // directed to someone else — silent discard

    onIncoming({
      senderUUID: header.sender,
      isDirected: header.recipient !== BROADCAST,
      frameBits,
    });
  }

  // Drift-corrected 20ms analysis loop via requestAnimationFrame
  let lastTick = performance.now();
  let rafId;

  function loop(timestamp) {
    if (timestamp - lastTick >= SYMBOL_MS) {
      tick();
      lastTick += SYMBOL_MS;
    }
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  return function stop() {
    cancelAnimationFrame(rafId);
    stream.getTracks().forEach(t => t.stop());
    ctx.close();
  };
}
