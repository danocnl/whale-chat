import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  identifyToneIndex, isWakePresent, symbolsToBits,
  bitsToNum, parseHeader, decodePayload,
} from './decoder.js';
import { assembleFrame, toSymbols } from './encoder.js';
import { encode as huffmanEncode } from './huffman.js';
import { crc16 } from './crc.js';

// Mock AudioContext so imports succeed — startListening() is browser-only
vi.stubGlobal('AudioContext', vi.fn(() => ({
  createOscillator: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() }, type: 'sine' })),
  createGain: vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } })),
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  createAnalyser: vi.fn(() => ({
    connect: vi.fn(),
    getFloatFrequencyData: vi.fn(),
    frequencyBinCount: 2048,
    fftSize: 4096,
    smoothingTimeConstant: 0,
  })),
  currentTime: 0,
  state: 'running',
  resume: vi.fn(() => Promise.resolve()),
  close: vi.fn(),
  destination: {},
})));

// ---------------------------------------------------------------------------
// Test helper — synthetic FFT data with peaks at specific frequencies
// ---------------------------------------------------------------------------
const FFT_SIZE   = 4096;
const SAMPLE_RATE = 44100;
const freqToBin  = f => Math.round(f * FFT_SIZE / SAMPLE_RATE);

const LOW_FREQS  = [16000, 16250, 16500, 16750, 17000, 17250, 17500, 17750];
const HIGH_FREQS = [18000, 18250, 18500, 18750, 19000, 19250, 19500, 19750];
const LOW_BINS   = LOW_FREQS.map(freqToBin);
const HIGH_BINS  = HIGH_FREQS.map(freqToBin);

function syntheticFFT(activeFreqs) {
  const data = new Float32Array(FFT_SIZE / 2).fill(-100);
  for (const freq of activeFreqs) {
    const bin = freqToBin(freq);
    if (bin < data.length) {
      data[bin]     = -10; // strong signal
      if (bin > 0)             data[bin - 1] = -25; // natural spillover
      if (bin < data.length-1) data[bin + 1] = -25;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// identifyToneIndex
// ---------------------------------------------------------------------------
describe('identifyToneIndex', () => {
  it('identifies each low-band tone correctly', () => {
    for (let i = 0; i < LOW_FREQS.length; i++) {
      const fft = syntheticFFT([LOW_FREQS[i]]);
      expect(identifyToneIndex(fft, LOW_BINS)).toBe(i);
    }
  });

  it('identifies each high-band tone correctly', () => {
    for (let i = 0; i < HIGH_FREQS.length; i++) {
      const fft = syntheticFFT([HIGH_FREQS[i]]);
      expect(identifyToneIndex(fft, HIGH_BINS)).toBe(i);
    }
  });

  it('returns the dominant tone when another is present but weaker', () => {
    const fft = syntheticFFT([16750]); // LOW_FREQS[3]
    fft[freqToBin(16000)] = -80; // weak background at tone 0
    expect(identifyToneIndex(fft, LOW_BINS)).toBe(3);
  });

  it('tone 0 gives index 0', () => {
    expect(identifyToneIndex(syntheticFFT([16000]), LOW_BINS)).toBe(0);
  });

  it('tone 7 gives index 7', () => {
    expect(identifyToneIndex(syntheticFFT([17750]), LOW_BINS)).toBe(7);
  });

  it('handles both sub-bands simultaneously without cross-contamination', () => {
    const fft = syntheticFFT([16500, 19000]); // LOW[2], HIGH[4]
    expect(identifyToneIndex(fft, LOW_BINS)).toBe(2);
    expect(identifyToneIndex(fft, HIGH_BINS)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// isWakePresent
// ---------------------------------------------------------------------------
describe('isWakePresent', () => {
  it('returns true when both WAKE frequencies (17kHz + 19kHz) are active', () => {
    expect(isWakePresent(syntheticFFT([17000, 19000]))).toBe(true);
  });

  it('returns false when only the low WAKE frequency is active', () => {
    expect(isWakePresent(syntheticFFT([17000]))).toBe(false);
  });

  it('returns false when only the high WAKE frequency is active', () => {
    expect(isWakePresent(syntheticFFT([19000]))).toBe(false);
  });

  it('returns false on a noise floor (all bins at -100 dB)', () => {
    const fft = new Float32Array(FFT_SIZE / 2).fill(-100);
    expect(isWakePresent(fft)).toBe(false);
  });

  it('returns false when data-band tones are active but not WAKE tones', () => {
    expect(isWakePresent(syntheticFFT([16000, 18000]))).toBe(false);
  });

  it('does not trigger on APP_SIG symbol tones alone', () => {
    // APP_SIG plays data FSK tones, not WAKE tones
    expect(isWakePresent(syntheticFFT([16250, 18750]))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// symbolsToBits
// ---------------------------------------------------------------------------
describe('symbolsToBits', () => {
  it('{lo:0, hi:0} → 6 zeros', () => {
    expect(symbolsToBits([{ lo: 0, hi: 0 }])).toEqual([0,0,0,0,0,0]);
  });

  it('{lo:7, hi:7} → 6 ones', () => {
    expect(symbolsToBits([{ lo: 7, hi: 7 }])).toEqual([1,1,1,1,1,1]);
  });

  it('{lo:2, hi:5} → [0,1,0, 1,0,1]', () => {
    // lo=2=010, hi=5=101
    expect(symbolsToBits([{ lo: 2, hi: 5 }])).toEqual([0,1,0,1,0,1]);
  });

  it('is the inverse of toSymbols (for multiples of 6 bits)', () => {
    const bits = [0,1,0,1,0,1, 1,0,1,0,1,0, 0,0,1,1,1,0]; // 18 bits, multiple of 6
    expect(symbolsToBits(toSymbols(bits))).toEqual(bits);
  });

  it('produces correct length (6 bits per symbol)', () => {
    expect(symbolsToBits([{ lo: 0, hi: 0 }, { lo: 7, hi: 7 }])).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// bitsToNum
// ---------------------------------------------------------------------------
describe('bitsToNum', () => {
  it('reads 8 bits to get 0xFF', () => {
    expect(bitsToNum([1,1,1,1,1,1,1,1], 0, 8)).toBe(0xFF);
  });

  it('reads 8 bits to get 0x00', () => {
    expect(bitsToNum([0,0,0,0,0,0,0,0], 0, 8)).toBe(0x00);
  });

  it('reads 8 bits to get 0xA3', () => {
    expect(bitsToNum([1,0,1,0,0,0,1,1], 0, 8)).toBe(0xA3);
  });

  it('reads from a non-zero start offset', () => {
    const bits = [0,0,0,0, 1,1,1,1];
    expect(bitsToNum(bits, 4, 4)).toBe(0xF);
  });

  it('treats missing bits as 0', () => {
    expect(bitsToNum([1], 0, 4)).toBe(0b1000);
  });
});

// ---------------------------------------------------------------------------
// parseHeader
// ---------------------------------------------------------------------------
describe('parseHeader', () => {
  it('parses APP_SIG correctly', () => {
    const frame = assembleFrame('hello');
    expect(parseHeader(frame).appSig).toBe(0xA3D7F1);
  });

  it('parses SENDER_UUID as an 8-char hex string', () => {
    const frame = assembleFrame('hello');
    expect(parseHeader(frame).sender).toMatch(/^[0-9a-f]{8}$/);
  });

  it('parses broadcast RECIPIENT_UUID as 0xFFFFFFFF', () => {
    const frame = assembleFrame('hello', null);
    expect(parseHeader(frame).recipient).toBe(0xFFFFFFFF);
  });

  it('parses directed RECIPIENT_UUID correctly', () => {
    const frame = assembleFrame('hello', 'b4e8f2d3');
    expect(parseHeader(frame).recipient.toString(16).padStart(8, '0')).toBe('b4e8f2d3');
  });

  it('parses charCount as the message length', () => {
    const text = 'hello world';
    expect(parseHeader(assembleFrame(text)).charCount).toBe(text.length);
  });

  it('parses NUM_COPIES as 2', () => {
    expect(parseHeader(assembleFrame('test')).numCopies).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// decodePayload
// ---------------------------------------------------------------------------
describe('decodePayload', () => {
  it('decodes a clean frame and returns crcStatus "clean"', () => {
    const text = 'Hello, world!';
    const result = decodePayload(assembleFrame(text));
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('clean');
  });

  it('decodes a single-char message', () => {
    const result = decodePayload(assembleFrame('a'));
    expect(result.text).toBe('a');
    expect(result.crcStatus).toBe('clean');
  });

  it('decodes a 280-char message', () => {
    const text = 'Hello world! '.repeat(22).slice(0, 280);
    const result = decodePayload(assembleFrame(text));
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('clean');
  });

  it('returns "recovered" when copy 2 payload is corrupted', () => {
    const text = 'test message';
    const frame = assembleFrame(text);
    const payloadBits = huffmanEncode(text);
    // Copy 2 starts after: DATA_START + payload1 + CRC1
    const copy2Start = 130 + payloadBits.length + 16;
    for (let i = copy2Start; i < copy2Start + 16; i++) frame[i] ^= 1;

    const result = decodePayload(frame);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('recovered');
  });

  it('returns "recovered" when copy 1 CRC is corrupted', () => {
    const text = 'test message';
    const frame = assembleFrame(text);
    const payloadBits = huffmanEncode(text);
    // Corrupt copy 1 CRC (16 bits immediately after payload 1)
    const crc1Start = 130 + payloadBits.length;
    for (let i = crc1Start; i < crc1Start + 16; i++) frame[i] ^= 1;

    const result = decodePayload(frame);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('recovered');
  });

  it('returns "corrupted" when both copy CRCs are flipped', () => {
    const text = 'test';
    const frame = assembleFrame(text);
    const payloadBits = huffmanEncode(text);
    const crc1Start = 130 + payloadBits.length;
    const crc2Start = crc1Start + 16 + payloadBits.length;
    for (let i = crc1Start; i < crc1Start + 16; i++) frame[i] ^= 1;
    for (let i = crc2Start; i < crc2Start + 16; i++) frame[i] ^= 1;

    const result = decodePayload(frame);
    expect(result.crcStatus).toBe('corrupted');
  });
});

// ---------------------------------------------------------------------------
// Full round-trip: encoder → toSymbols → symbolsToBits → decoder
// ---------------------------------------------------------------------------
describe('full round-trip', () => {
  it('short message round-trips cleanly', () => {
    const text = 'Hello!';
    const bits = symbolsToBits(toSymbols(assembleFrame(text)));
    const result = decodePayload(bits);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('clean');
  });

  it('full English sentence round-trips cleanly', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const bits = symbolsToBits(toSymbols(assembleFrame(text)));
    const result = decodePayload(bits);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('clean');
  });

  it('directed message has correct RECIPIENT_UUID in header', () => {
    const text = 'Hi there!';
    const bits = symbolsToBits(toSymbols(assembleFrame(text, 'deadbeef')));
    const header = parseHeader(bits);
    expect(header.recipient.toString(16).padStart(8, '0')).toBe('deadbeef');
  });

  it('parseHeader after toSymbols round-trip preserves APP_SIG', () => {
    const bits = symbolsToBits(toSymbols(assembleFrame('hello')));
    expect(parseHeader(bits).appSig).toBe(0xA3D7F1);
  });

  it.todo('startListening — resolves with a stop() function');
  it.todo('live microphone input detects a real transmission from the encoder');
});
