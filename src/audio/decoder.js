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
// 1024-sample FFT = 23ms window ≈ 1 symbol period (20ms).
// 4096 (93ms) contaminated the spectrum with 4-5 previous symbols,
// making tone identification unreliable.
const FFT_SIZE      = 1024;
const SYMBOL_MS     = 80; // must match encoder SYMBOL_S × 1000

// 4-FSK: 4 tones per sub-band, 500 Hz spacing — must match encoder exactly
const LOW_FREQS  = [4000, 4500, 5000, 5500];
const HIGH_FREQS = [6000, 6500, 7000, 7500];
// Must match encoder exactly — see encoder.js for rationale
const WAKE_LOW   = 3000; // 1000 Hz below low data band
const WAKE_HIGH  = 8500; // 1000 Hz above high data band
const APP_SIG    = 0xA3D7F1;
const BROADCAST  = 0xFFFFFFFF;

// Pre-compute FFT bin indices for all protocol frequencies
const freqToBin = f => Math.round(f * FFT_SIZE / SAMPLE_RATE);
const LOW_BINS      = LOW_FREQS.map(freqToBin);
const HIGH_BINS     = HIGH_FREQS.map(freqToBin);
const WAKE_LOW_BIN  = freqToBin(WAKE_LOW);
const WAKE_HIGH_BIN = freqToBin(WAKE_HIGH);

// Signal threshold (dBFS). Chosen to sit cleanly between:
//   - Actual WAKE/END signal: -24 to -40 dBFS   → above threshold ✓
//   - Data-phase cross-contamination: -68 to -87 dBFS → below threshold ✓
//   - Noise floor: -120 to -165 dBFS             → well below threshold ✓
const SIGNAL_DB = -70;

// WAKE must be sustained for at least this many ticks (20ms each) = 400ms
const WAKE_MIN_TICKS = 5;  // 5 × 80ms = 400ms — WAKE is 500ms = 6.25 ticks at 80ms each

// Maximum data symbols to buffer before declaring a frame invalid
// 4-FSK: 4 bits/symbol. 1800 × 4 = 7200 bits — enough for 3 × max payload + overhead
const MAX_FRAME_SYMBOLS = 1800;

// Frame bit offsets — relative to the ALIGNED frame start (last APP_SIG copy).
// After alignment, the structure is identical to the single-copy case:
//   APP_SIG(24) → SYNC(18) → SENDER(32) → RECIPIENT(32) → COPIES(8) → LENGTH(16) → DATA
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
  DATA_START:      130,  // relative to aligned (sliced) frame
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
// 4-FSK: 2 bits per sub-band per symbol → 4 bits total per symbol
export function symbolsToBits(symbols) {
  const bits = [];
  for (const { lo, hi } of symbols) {
    bits.push((lo >> 1) & 1, lo & 1);
    bits.push((hi >> 1) & 1, hi & 1);
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
 * Find the last occurrence of APP_SIG in the first ~96 bits of a frame buffer.
 * APP_SIG is transmitted 3× so the decoder can align even if early copies are missed.
 * Returns the bit offset of the last match, or -1 if not found.
 * Exported for testing.
 *
 * @param {number[]} bits
 * @returns {number}
 */
function popcount(n) {
  let c = 0;
  while (n) { c += n & 1; n >>>= 1; }
  return c;
}

export function findLastAppSig(bits) {
  let lastOffset = -1;
  let bestDist   = Infinity;
  const limit    = Math.min(bits.length - 24, 90); // 3 copies × 24 bits + margin
  for (let i = 0; i <= limit; i += 4) {  // step by 1 symbol (4 bits in 4-FSK)
    const dist = popcount(bitsToNum(bits, i, 24) ^ APP_SIG);
    // ≤ (not <) so we always prefer the LAST occurrence of the best match
    if (dist <= 3 && dist <= bestDist) {
      bestDist   = dist;
      lastOffset = i;
    }
  }
  return lastOffset;
}

/**
 * Parse all header fields from the frame bit buffer.
 * Automatically aligns to the last APP_SIG occurrence in the preamble,
 * handling timing offsets where the first 1-2 copies may have been missed.
 *
 * @param {number[]} bits
 * @returns {{ appSig, sender, recipient, numCopies, charCount, _offset }}
 */
export function parseHeader(bits) {
  const found  = findLastAppSig(bits); // -1 = not found within tolerance
  const offset = found >= 0 ? found : 0;
  const b      = offset > 0 ? bits.slice(offset) : bits;

  const appSig    = bitsToNum(b, OFF.APP_SIG_START, 24);
  const sender    = bitsToNum(b, OFF.SENDER_START, 32)
                      .toString(16).padStart(8, '0');
  const recipient = bitsToNum(b, OFF.RECIPIENT_START, 32);
  const numCopies = bitsToNum(b, OFF.COPIES_START, 8);
  const charCount = bitsToNum(b, OFF.LENGTH_START, 16);
  // _appSigFound: true if fuzzy search located APP_SIG (even with ≤3 bit errors)
  return { appSig, sender, recipient, numCopies, charCount, _offset: offset, _appSigFound: found >= 0 };
}

/**
 * Decode the payload section after a user accepts an incoming message.
 * Handles CRC verification, fallback to the clean copy, and majority-bit voting.
 *
 * @param {number[]} frameBits - Full frame bit buffer (starting at APP_SIG)
 * @returns {{ text: string, crcStatus: 'clean'|'recovered'|'corrupted' }}
 */
export function decodePayload(rawFrameBits) {
  const { numCopies, charCount, _offset } = parseHeader(rawFrameBits);
  const frameBits = _offset > 0 ? rawFrameBits.slice(_offset) : rawFrameBits;

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

  const passingCopies = copies.filter(c => c.crcValid);
  const majority = Math.ceil(copies.length / 2); // ≥2 of 3

  let result;

  if (passingCopies.length === copies.length) {
    // All copies clean
    result = { text: passingCopies[0].text, crcStatus: 'clean' };
  } else if (passingCopies.length >= majority) {
    // Majority pass — message is reliable, one copy had a bad moment
    result = { text: passingCopies[0].text, crcStatus: 'clean' };
  } else if (passingCopies.length > 0) {
    // Minority pass
    result = { text: passingCopies[0].text, crcStatus: 'recovered' };
  } else {
    // None pass — majority-bit vote on raw payload bits, attempt decode
    const voted = majorityVote(copies.map(c => c.rawBits));
    try {
      const { text } = decodeWithLength(voted, charCount);
      result = { text, crcStatus: 'corrupted' };
    } catch {
      result = { text: copies[0]?.text ?? '', crcStatus: 'corrupted' };
    }
  }

  console.log('[decoder] received (' + result.crcStatus + '):', JSON.stringify(result.text));
  return result;
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
  analyser.fftSize               = FFT_SIZE;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);

  // Use the ACTUAL sample rate — device may not honour the requested 44100.
  // If there's a mismatch our bin indices will target the wrong frequencies.
  const actualRate = ctx.sampleRate;
  const bin = f => Math.round(f * FFT_SIZE / actualRate);

  const actualLowBins      = LOW_FREQS.map(bin);
  const actualHighBins     = HIGH_FREQS.map(bin);
  const actualWakeLowBin   = bin(WAKE_LOW);
  const actualWakeHighBin  = bin(WAKE_HIGH);

  console.log('[decoder] started — actual sample rate:', actualRate,
    '| WAKE bins:', actualWakeLowBin, actualWakeHighBin,
    '| expected:', freqToBin(WAKE_LOW), freqToBin(WAKE_HIGH));

  const fftData = new Float32Array(analyser.frequencyBinCount);

  let state           = 'IDLE';
  let wakeTicks       = 0;
  let endTicks        = 0;
  let blackoutRemaining = 0; // ticks to ignore after WAKING→RECEIVING (lets tail fully decay)
  let receivingReady  = false;
  let symbols         = [];
  let debugTick       = 0;

  // After transitioning to RECEIVING, ignore all tones for this many ticks (300ms).
  // Ensures the WAKE tail has fully decayed before we start collecting or detecting END.
  const BLACKOUT_TICKS = 2; // 2 × 80ms = 160ms — covers WAKE tail decay

  const END_MIN_TICKS  = 3;  // 3 × 80ms = 240ms sustained WAKE — END signal is 300ms

  function wakePresent() {
    return fftData[actualWakeLowBin] > SIGNAL_DB &&
           fftData[actualWakeHighBin] > SIGNAL_DB;
  }

  function tick() {
    analyser.getFloatFrequencyData(fftData);
    const wakeNow = wakePresent();

    // Log signal levels at WAKE frequencies every ~200ms for debugging
    if (++debugTick % 10 === 0) {
      console.log('[decoder] state:', state,
        '| WAKE_LOW dB:', fftData[actualWakeLowBin]?.toFixed(1),
        '| WAKE_HIGH dB:', fftData[actualWakeHighBin]?.toFixed(1),
        '| threshold:', SIGNAL_DB);
    }

    switch (state) {
      case 'IDLE':
        if (wakeNow) { state = 'WAKING'; wakeTicks = 1; }
        break;

      case 'WAKING':
        if (wakeNow) {
          wakeTicks++;
        } else {
          if (wakeTicks >= WAKE_MIN_TICKS) {
            // WAKE confirmed — start blackout to let tail decay before collecting
            state             = 'RECEIVING';
            blackoutRemaining = BLACKOUT_TICKS;
            receivingReady    = false;
            symbols           = [];
            console.log('[decoder] WAKING→RECEIVING, blackout started', BLACKOUT_TICKS, 'ticks');
          } else {
            // Too short — false positive, ignore
            state     = 'IDLE';
            wakeTicks = 0;
          }
        }
        break;

      case 'RECEIVING': {
        // Blackout: ignore everything for the first BLACKOUT_TICKS after WAKING
        if (blackoutRemaining > 0) {
          blackoutRemaining--;
          if (blackoutRemaining === 0) {
            console.log('[decoder] blackout ended — now collecting data symbols');
            receivingReady = true;
          }
          break;
        }

        if (wakeNow) {
          // Potential END signal
          endTicks++;
          console.log('[decoder] END tick', endTicks, '/', END_MIN_TICKS,
            '| symbols so far:', symbols.length);
          if (endTicks >= END_MIN_TICKS) {
            console.log('[decoder] END confirmed — symbols collected:', symbols.length);
            if (symbols.length >= 24) {
              processFrame(symbolsToBits(symbols));
            } else {
              console.log('[decoder] too few symbols, discarding frame');
            }
            state             = 'IDLE';
            wakeTicks         = 0;
            endTicks          = 0;
            blackoutRemaining = 0;
            receivingReady    = false;
            symbols           = [];
          }
        } else {
          endTicks = 0;
          const lo = identifyToneIndex(fftData, actualLowBins);
          const hi = identifyToneIndex(fftData, actualHighBins);
          symbols.push({ lo, hi });

          if (symbols.length > MAX_FRAME_SYMBOLS) {
            console.log('[decoder] frame too long, abandoning');
            state             = 'IDLE';
            blackoutRemaining = 0;
            receivingReady    = false;
            symbols           = [];
          }
        }
        break;
      }
    }
  }

  function processFrame(frameBits) {
    const header = parseHeader(frameBits);
    const recipientHex = header.recipient.toString(16).padStart(8, '0');
    const dist = popcount(header.appSig ^ APP_SIG);
    console.log('[decoder] processFrame — appSig:', header.appSig.toString(16),
      dist === 0 ? '✓' : `(${dist} bit errors)`,
      'alignOffset:', header._offset,
      'sender:', header.sender, 'recipient:', recipientHex,
      'charCount:', header.charCount);

    if (!header._appSigFound) {
      console.log('[decoder] APP_SIG not found in preamble (too many bit errors)');
      return;
    }
    // Note: header.appSig may differ slightly from APP_SIG (≤3 bit errors tolerated) —
    // use _appSigFound not exact equality

    // charCount sanity check — bit errors can produce wildly wrong values
    if (header.charCount === 0 || header.charCount > 280) {
      console.log('[decoder] charCount out of range:', header.charCount, '— discarding');
      return;
    }

    const myUUID  = getShortUUID();
    const isBroadcast = header.recipient === BROADCAST;
    const isDirected  = !isBroadcast && recipientHex === myUUID;
    // Accept broadcast OR directed-to-me. With bit errors, recipient bits
    // may be corrupted — if charCount is valid and APP_SIG matched, treat
    // as broadcast so the user can still accept/reject via the UI prompt.
    const isForMe = isBroadcast || isDirected ||
                    header.recipient.toString(2).split('1').length - 1 > 28; // ≥29 of 32 bits set → corrupted broadcast

    if (!isForMe) {
      console.log('[decoder] not for me — recipient:', recipientHex, 'me:', myUUID);
      return;
    }

    onIncoming({
      senderUUID: header.sender,
      isDirected:  isDirected,
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
