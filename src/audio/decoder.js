/**
 * RX Audio Engine — tone detection, state machine, frame parsing.
 *
 * Architecture: pure functions (testable in Node) + browser-only startListening().
 *
 * Pure exports: identifyToneIndex, isWakePresent, symbolsToBits,
 *               bitsToNum, parseHeader, decodePayload
 *
 * State machine: IDLE → WAKING → RECEIVING → IDLE
 */

import { decodeWithLength } from './huffman.js';
import { rsDecode } from './rs.js';
import { HEADER_NSYM, DATA_NSYM, HEADER_DATA_K } from './encoder.js';
import { getShortUUID } from '../storage/store.js';

// ── Protocol constants ────────────────────────────────────────
const SAMPLE_RATE = 44100;
const FFT_SIZE    = 1024;
const SYMBOL_MS   = 80;

// 4 bands, 4-FSK each, 250 Hz spacing — must match encoder exactly
const BAND_A = [4000, 4250, 4500, 4750];
const BAND_B = [5000, 5250, 5500, 5750];
const BAND_C = [6000, 6250, 6500, 6750];
const BAND_D = [7000, 7250, 7500, 7750];

const WAKE_LOW  = 3000;
const WAKE_HIGH = 8500;
const APP_SIG   = 0xA3D7F1;
const BROADCAST = 0xFFFFFFFF;

const freqToBin    = f => Math.round(f * FFT_SIZE / SAMPLE_RATE);
const BINS_A       = BAND_A.map(freqToBin);
const BINS_B       = BAND_B.map(freqToBin);
const BINS_C       = BAND_C.map(freqToBin);
const BINS_D       = BAND_D.map(freqToBin);
const WAKE_LOW_BIN  = freqToBin(WAKE_LOW);
const WAKE_HIGH_BIN = freqToBin(WAKE_HIGH);

// -70 dBFS: WAKE signal at -24 to -40 dBFS (above); noise at -120+ dBFS (below).
const SIGNAL_DB = -70;

// WAKE must be sustained for at least 3 ticks = 240ms.
// WAKE_S is now 800ms (10 ticks) — gives 7-tick margin, very robust.
const WAKE_MIN_TICKS    = 3;
const MAX_FRAME_SYMBOLS = 1800;

// Frame bit offsets — relative to aligned frame start (last APP_SIG copy).
//   APP_SIG(24) → SYNC(18) → RS_HEADER((HEADER_DATA_K+HEADER_NSYM)×8) → RS_PAYLOAD
const RS_HEADER_BYTES = HEADER_DATA_K + HEADER_NSYM; // 11 + 8 = 19
const OFF = {
  APP_SIG_START:    0,
  APP_SIG_END:      24,
  SYNC_START:       24,
  SYNC_END:         42,
  RS_HEADER_START:  42,
  RS_HEADER_END:    42 + RS_HEADER_BYTES * 8,  // = 42 + 152 = 194
  DATA_START:       42 + RS_HEADER_BYTES * 8,  // = 194
};

// ── Pure helpers ──────────────────────────────────────────────
function popcount(n) { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }

// Extract numBytes bytes starting at startBit from a bit array
function extractBytes(bits, startBit, numBytes) {
  const out = new Uint8Array(numBytes);
  for (let i = 0; i < numBytes; i++)
    for (let j = 0; j < 8; j++)
      if (bits[startBit + i * 8 + j]) out[i] |= (1 << (7 - j));
  return out;
}

// ── Pure exports ──────────────────────────────────────────────

export function identifyToneIndex(fftData, bins) {
  let maxDb = -Infinity, maxIdx = 0;
  for (let i = 0; i < bins.length; i++) {
    if (fftData[bins[i]] > maxDb) { maxDb = fftData[bins[i]]; maxIdx = i; }
  }
  return maxIdx;
}

export function isWakePresent(fftData) {
  return fftData[WAKE_LOW_BIN] > SIGNAL_DB && fftData[WAKE_HIGH_BIN] > SIGNAL_DB;
}

/**
 * Convert 4-band symbol array to flat bit array.
 * Each symbol has {a, b, c, d} indices (0–3), yielding 8 bits per symbol.
 */
export function symbolsToBits(symbols) {
  const bits = [];
  for (const { a, b, c, d } of symbols) {
    bits.push((a >> 1) & 1, a & 1);
    bits.push((b >> 1) & 1, b & 1);
    bits.push((c >> 1) & 1, c & 1);
    bits.push((d >> 1) & 1, d & 1);
  }
  return bits;
}

export function bitsToNum(bits, start, len) {
  let n = 0;
  for (let i = 0; i < len; i++) n = (n << 1) | (bits[start + i] ?? 0);
  return n >>> 0;
}

export function findLastAppSig(bits) {
  let lastOffset = -1, bestDist = Infinity;
  const limit = Math.min(bits.length - 24, 66);
  for (let i = 0; i <= limit; i += 8) { // step by 1 symbol = 8 bits now
    const dist = popcount(bitsToNum(bits, i, 24) ^ APP_SIG);
    if (dist <= 3 && dist <= bestDist) { bestDist = dist; lastOffset = i; }
  }
  return lastOffset;
}

/**
 * Parse header, RS-decoding the header block to recover UUID fields.
 */
export function parseHeader(bits) {
  const found  = findLastAppSig(bits);
  const offset = found >= 0 ? found : 0;
  const b      = offset > 0 ? bits.slice(offset) : bits;

  const appSig = bitsToNum(b, OFF.APP_SIG_START, 24);

  // Extract and RS-decode the header block
  const rsHeaderBytes = extractBytes(b, OFF.RS_HEADER_START, RS_HEADER_BYTES);
  let hd;
  try {
    const { data } = rsDecode(rsHeaderBytes, HEADER_NSYM);
    hd = data;
  } catch {
    hd = rsHeaderBytes.slice(0, HEADER_DATA_K); // best-effort if uncorrectable
  }

  const senderInt    = ((hd[0]<<24)|(hd[1]<<16)|(hd[2]<<8)|hd[3]) >>> 0;
  const sender       = senderInt.toString(16).padStart(8, '0');
  const recipientInt = ((hd[4]<<24)|(hd[5]<<16)|(hd[6]<<8)|hd[7]) >>> 0;
  const charCount    = (hd[8] << 8) | hd[9];
  const dataK        = hd[10];

  return { appSig, sender, recipient: recipientInt, charCount, dataK,
           _offset: offset, _appSigFound: found >= 0 };
}

/**
 * Decode the payload using RS FEC then Huffman decode.
 */
export function decodePayload(rawFrameBits) {
  const { charCount, dataK, _offset } = parseHeader(rawFrameBits);
  const b = _offset > 0 ? rawFrameBits.slice(_offset) : rawFrameBits;

  const totalPayloadBytes = dataK + DATA_NSYM;
  const cwBytes = extractBytes(b, OFF.DATA_START, totalPayloadBytes);

  let result;
  try {
    const { data, errors } = rsDecode(cwBytes, DATA_NSYM);
    const dataBits = [];
    for (const byte of data) for (let bit = 7; bit >= 0; bit--) dataBits.push((byte >> bit) & 1);
    const { text } = decodeWithLength(dataBits, charCount);
    result = { text, crcStatus: errors === 0 ? 'clean' : 'recovered' };
  } catch {
    // RS uncorrectable — attempt raw Huffman on first dataK bytes
    const dataBits = [];
    for (let i = 0; i < dataK; i++)
      for (let bit = 7; bit >= 0; bit--) dataBits.push((cwBytes[i] >> bit) & 1);
    try {
      const { text } = decodeWithLength(dataBits, charCount);
      result = { text, crcStatus: 'corrupted' };
    } catch {
      result = { text: '', crcStatus: 'corrupted' };
    }
  }

  console.log('[decoder] received (' + result.crcStatus + '):', JSON.stringify(result.text));
  return result;
}

// ── Browser-only ──────────────────────────────────────────────
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

  const actualRate = ctx.sampleRate;
  const bin = f => Math.round(f * FFT_SIZE / actualRate);

  const aBins = BAND_A.map(bin), bBins = BAND_B.map(bin);
  const cBins = BAND_C.map(bin), dBins = BAND_D.map(bin);
  const wakeLowBin  = bin(WAKE_LOW);
  const wakeHighBin = bin(WAKE_HIGH);

  console.log('[decoder] started — actual rate:', actualRate,
    '| WAKE bins:', wakeLowBin, wakeHighBin);

  const fftData = new Float32Array(analyser.frequencyBinCount);

  let state = 'IDLE', wakeTicks = 0, endTicks = 0;
  let blackoutRemaining = 0, symbols = [], debugTick = 0;

  const BLACKOUT_TICKS = 2;
  const END_MIN_TICKS  = 3;

  function wakePresent() {
    return fftData[wakeLowBin] > SIGNAL_DB && fftData[wakeHighBin] > SIGNAL_DB;
  }

  function tick() {
    analyser.getFloatFrequencyData(fftData);
    const wakeNow = wakePresent();

    if (++debugTick % 10 === 0) {
      console.log('[decoder] state:', state,
        '| WAKE_LOW:', fftData[wakeLowBin]?.toFixed(1),
        '| WAKE_HIGH:', fftData[wakeHighBin]?.toFixed(1),
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
            state = 'RECEIVING'; blackoutRemaining = BLACKOUT_TICKS;
            symbols = [];
            console.log('[decoder] WAKING→RECEIVING, blackout', BLACKOUT_TICKS, 'ticks');
          } else {
            state = 'IDLE'; wakeTicks = 0;
          }
        }
        break;

      case 'RECEIVING': {
        if (blackoutRemaining > 0) {
          blackoutRemaining--;
          if (blackoutRemaining === 0)
            console.log('[decoder] blackout ended — collecting symbols');
          break;
        }
        if (wakeNow) {
          endTicks++;
          if (endTicks >= END_MIN_TICKS) {
            console.log('[decoder] END confirmed — symbols:', symbols.length);
            if (symbols.length >= 24) processFrame(symbolsToBits(symbols));
            else console.log('[decoder] too few symbols, discarding');
            state = 'IDLE'; wakeTicks = endTicks = blackoutRemaining = 0; symbols = [];
          }
        } else {
          endTicks = 0;
          symbols.push({
            a: identifyToneIndex(fftData, aBins),
            b: identifyToneIndex(fftData, bBins),
            c: identifyToneIndex(fftData, cBins),
            d: identifyToneIndex(fftData, dBins),
          });
          if (symbols.length > MAX_FRAME_SYMBOLS) {
            console.log('[decoder] frame too long, abandoning');
            state = 'IDLE'; blackoutRemaining = 0; symbols = [];
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
      'sender:', header.sender, 'recipient:', recipientHex,
      'charCount:', header.charCount, 'dataK:', header.dataK);

    if (!header._appSigFound) {
      console.log('[decoder] APP_SIG not found'); return;
    }
    if (header.charCount === 0 || header.charCount > 280) {
      console.log('[decoder] charCount out of range:', header.charCount); return;
    }
    if (header.dataK === 0 || header.dataK > 240) {
      console.log('[decoder] dataK out of range:', header.dataK); return;
    }

    const myUUID   = getShortUUID();
    const isBcast  = header.recipient === BROADCAST;
    const isDirect = !isBcast && recipientHex === myUUID;
    const isForMe  = isBcast || isDirect ||
                     header.recipient.toString(2).split('1').length - 1 > 28;

    if (!isForMe) {
      console.log('[decoder] not for me:', recipientHex, 'vs', myUUID); return;
    }

    onIncoming({ senderUUID: header.sender, isDirected: isDirect, frameBits });
  }

  let lastTick = performance.now();
  let rafId;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (now - lastTick >= SYMBOL_MS) { lastTick += SYMBOL_MS; tick(); }
  }
  rafId = requestAnimationFrame(loop);

  return function stop() {
    cancelAnimationFrame(rafId);
    analyser.disconnect();
    source.disconnect();
    ctx.close();
    stream.getTracks().forEach(t => t.stop());
  };
}
