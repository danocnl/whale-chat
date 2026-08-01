import { describe, it, expect, vi } from 'vitest';
import {
  identifyToneIndex, isWakePresent, symbolsToBits,
  bitsToNum, parseHeader, decodePayload,
} from './decoder.js';
import { assembleFrame, toSymbols, HEADER_NSYM, HEADER_DATA_K, DATA_NSYM } from './encoder.js';

vi.stubGlobal('AudioContext', vi.fn(() => ({
  createOscillator: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() }, type: 'sine' })),
  createGain:       vi.fn(() => ({ connect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn() } })),
  createDynamicsCompressor: vi.fn(() => ({ connect: vi.fn(), threshold:{value:0}, knee:{value:0}, ratio:{value:0}, attack:{value:0}, release:{value:0} })),
  createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  createAnalyser: vi.fn(() => ({
    connect: vi.fn(), getFloatFrequencyData: vi.fn(),
    frequencyBinCount: 2048, fftSize: 1024, smoothingTimeConstant: 0,
  })),
  currentTime: 0, state: 'running',
  resume: vi.fn(() => Promise.resolve()), close: vi.fn(), destination: {},
})));

const FFT_SIZE   = 1024;
const SAMPLE_RATE = 44100;
const freqToBin  = f => Math.round(f * FFT_SIZE / SAMPLE_RATE);

// 4-band frequencies (must match decoder constants)
const BAND_A = [4000, 4250, 4500, 4750];
const BAND_B = [5000, 5250, 5500, 5750];
const BAND_C = [6000, 6250, 6500, 6750];
const BAND_D = [7000, 7250, 7500, 7750];
const BINS_A = BAND_A.map(freqToBin);
const BINS_B = BAND_B.map(freqToBin);
const BINS_C = BAND_C.map(freqToBin);
const BINS_D = BAND_D.map(freqToBin);

function syntheticFFT(activeFreqs) {
  const data = new Float32Array(FFT_SIZE / 2).fill(-100);
  for (const freq of activeFreqs) {
    const bin = freqToBin(freq);
    if (bin < data.length) {
      data[bin] = -10;
      if (bin > 0)             data[bin - 1] = -25;
      if (bin < data.length-1) data[bin + 1] = -25;
    }
  }
  return data;
}

// ── identifyToneIndex ─────────────────────────────────────────
describe('identifyToneIndex', () => {
  it('identifies each BAND_A tone correctly', () => {
    for (let i = 0; i < BAND_A.length; i++)
      expect(identifyToneIndex(syntheticFFT([BAND_A[i]]), BINS_A)).toBe(i);
  });
  it('identifies each BAND_B tone correctly', () => {
    for (let i = 0; i < BAND_B.length; i++)
      expect(identifyToneIndex(syntheticFFT([BAND_B[i]]), BINS_B)).toBe(i);
  });
  it('identifies each BAND_C tone correctly', () => {
    for (let i = 0; i < BAND_C.length; i++)
      expect(identifyToneIndex(syntheticFFT([BAND_C[i]]), BINS_C)).toBe(i);
  });
  it('identifies each BAND_D tone correctly', () => {
    for (let i = 0; i < BAND_D.length; i++)
      expect(identifyToneIndex(syntheticFFT([BAND_D[i]]), BINS_D)).toBe(i);
  });
  it('returns the dominant tone with a weaker background tone', () => {
    const fft = syntheticFFT([4750]); // BAND_A[3]
    fft[freqToBin(4000)] = -80; // weak background
    expect(identifyToneIndex(fft, BINS_A)).toBe(3);
  });
  it('all 4 bands detected simultaneously without cross-contamination', () => {
    const fft = syntheticFFT([4500, 5250, 6750, 7000]); // A[2], B[1], C[3], D[0]
    expect(identifyToneIndex(fft, BINS_A)).toBe(2);
    expect(identifyToneIndex(fft, BINS_B)).toBe(1);
    expect(identifyToneIndex(fft, BINS_C)).toBe(3);
    expect(identifyToneIndex(fft, BINS_D)).toBe(0);
  });
});

// ── isWakePresent ─────────────────────────────────────────────
describe('isWakePresent', () => {
  it('returns true when both WAKE tones are active', () => {
    expect(isWakePresent(syntheticFFT([3000, 8500]))).toBe(true);
  });
  it('returns false when only WAKE_LOW is active', () => {
    expect(isWakePresent(syntheticFFT([3000]))).toBe(false);
  });
  it('returns false when only WAKE_HIGH is active', () => {
    expect(isWakePresent(syntheticFFT([8500]))).toBe(false);
  });
  it('returns false on noise floor', () => {
    expect(isWakePresent(new Float32Array(FFT_SIZE / 2).fill(-100))).toBe(false);
  });
  it('returns false when data-band tones are active but not WAKE tones', () => {
    expect(isWakePresent(syntheticFFT([4000, 6000]))).toBe(false);
  });
});

// ── symbolsToBits ─────────────────────────────────────────────
describe('symbolsToBits', () => {
  it('{a:0,b:0,c:0,d:0} → 8 zeros', () => {
    expect(symbolsToBits([{ a:0, b:0, c:0, d:0 }])).toEqual([0,0,0,0,0,0,0,0]);
  });
  it('{a:3,b:3,c:3,d:3} → 8 ones', () => {
    expect(symbolsToBits([{ a:3, b:3, c:3, d:3 }])).toEqual([1,1,1,1,1,1,1,1]);
  });
  it('{a:2,b:1,c:3,d:0} → correct bit pattern', () => {
    expect(symbolsToBits([{ a:2, b:1, c:3, d:0 }])).toEqual([1,0,0,1,1,1,0,0]);
  });
  it('is the inverse of toSymbols (for multiples of 8 bits)', () => {
    const bits = [0,1,1,0, 1,0,0,1, 1,1,0,0, 0,1,0,1]; // 16 bits
    expect(symbolsToBits(toSymbols(bits))).toEqual(bits);
  });
  it('produces 8 bits per symbol', () => {
    expect(symbolsToBits([{ a:0,b:0,c:0,d:0 }, { a:3,b:3,c:3,d:3 }])).toHaveLength(16);
  });
});

// ── bitsToNum ─────────────────────────────────────────────────
describe('bitsToNum', () => {
  it('reads 8 bits to get 0xFF', () => { expect(bitsToNum([1,1,1,1,1,1,1,1], 0, 8)).toBe(0xFF); });
  it('reads 8 bits to get 0x00', () => { expect(bitsToNum([0,0,0,0,0,0,0,0], 0, 8)).toBe(0x00); });
  it('reads 8 bits to get 0xA3', () => { expect(bitsToNum([1,0,1,0,0,0,1,1], 0, 8)).toBe(0xA3); });
  it('reads from a non-zero offset', () => {
    expect(bitsToNum([0,0,0,0, 1,1,1,1], 4, 4)).toBe(0xF);
  });
});

// ── parseHeader ───────────────────────────────────────────────
describe('parseHeader', () => {
  it('parses APP_SIG correctly', () => {
    expect(parseHeader(assembleFrame('hello')).appSig).toBe(0xA3D7F1);
  });
  it('parses SENDER_UUID as an 8-char hex string', () => {
    expect(parseHeader(assembleFrame('hello')).sender).toMatch(/^[0-9a-f]{8}$/);
  });
  it('parses broadcast RECIPIENT as 0xFFFFFFFF', () => {
    expect(parseHeader(assembleFrame('hello')).recipient).toBe(0xFFFFFFFF);
  });
  it('parses directed RECIPIENT correctly', () => {
    expect(parseHeader(assembleFrame('hello', 'b4e8f2d3')).recipient.toString(16).padStart(8,'0'))
      .toBe('b4e8f2d3');
  });
  it('parses charCount as message length', () => {
    const text = 'hello world';
    expect(parseHeader(assembleFrame(text)).charCount).toBe(text.length);
  });
  it('parses dataK as the number of Huffman bytes', () => {
    const h = parseHeader(assembleFrame('test'));
    expect(h.dataK).toBeGreaterThan(0);
    expect(h.dataK).toBeLessThan(32);
  });
  it('sets _appSigFound=true on a valid frame', () => {
    expect(parseHeader(assembleFrame('test'))._appSigFound).toBe(true);
  });
});

// ── decodePayload ─────────────────────────────────────────────
describe('decodePayload', () => {
  it('decodes a clean frame with crcStatus "clean"', () => {
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
  it('returns "recovered" when 1 RS payload byte is corrupted', () => {
    const text = 'test message';
    const frame = [...assembleFrame(text)];
    // RS_PAYLOAD starts at: last_APP_SIG_offset(24) + SYNC+APP_SIG(42) + RS_HEADER_bits(152) = 218
    const RS_PAYLOAD_ABS = 24 + 42 + (HEADER_DATA_K + HEADER_NSYM) * 8;
    for (let i = 0; i < 8; i++) frame[RS_PAYLOAD_ABS + i] ^= 1; // corrupt 1 byte
    const result = decodePayload(frame);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('recovered');
  });
  it('survives symbolsToBits round-trip', () => {
    const text = 'This is a round-trip test';
    const bits = symbolsToBits(toSymbols(assembleFrame(text)));
    const result = decodePayload(bits);
    expect(result.text).toBe(text);
    expect(result.crcStatus).toBe('clean');
  });
  it('directed message preserves RECIPIENT_UUID through RS header', () => {
    const bits = symbolsToBits(toSymbols(assembleFrame('Hi there!', 'deadbeef')));
    const header = parseHeader(bits);
    expect(header.recipient.toString(16).padStart(8,'0')).toBe('deadbeef');
  });
  it('parseHeader after toSymbols round-trip preserves APP_SIG', () => {
    const bits = symbolsToBits(toSymbols(assembleFrame('hello')));
    expect(parseHeader(bits).appSig).toBe(0xA3D7F1);
  });

  it.todo('startListening — resolves with a stop() function');
  it.todo('live microphone input detects a real transmission from the encoder');
});
