import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateMessage, estimateDuration, assembleFrame, toSymbols } from './encoder.js';
import { encode as huffmanEncode } from './huffman.js';
import { crc16 } from './crc.js';

// AudioContext is not available in the test environment — mock it so
// imports succeed. transmit() is tested separately with a full mock.
vi.stubGlobal('AudioContext', vi.fn(() => ({
  createOscillator: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() }, type: 'sine' })),
  createGain: vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } })),
  currentTime: 0,
  state: 'running',
  resume: vi.fn(() => Promise.resolve()),
  destination: {},
})));

// ---------------------------------------------------------------------------
// validateMessage
// ---------------------------------------------------------------------------
describe('validateMessage', () => {
  it('accepts plain English text', () => {
    expect(validateMessage('Hello, world!')).toEqual({ valid: true });
  });

  it('accepts all allowed characters', () => {
    const text = 'ABCabc 123 .,!?\'"()-:;/@#_\n';
    expect(validateMessage(text)).toEqual({ valid: true });
  });

  it('rejects empty string', () => {
    expect(validateMessage('')).toMatchObject({ valid: false });
  });

  it('rejects text over 280 chars', () => {
    expect(validateMessage('a'.repeat(281))).toMatchObject({ valid: false });
  });

  it('accepts exactly 280 chars', () => {
    expect(validateMessage('a'.repeat(280))).toEqual({ valid: true });
  });

  it('rejects accented characters', () => {
    expect(validateMessage('héllo')).toMatchObject({ valid: false });
  });

  it('rejects emoji', () => {
    expect(validateMessage('hi 🎉')).toMatchObject({ valid: false });
  });

  it('rejects null bytes', () => {
    expect(validateMessage('hi\0there')).toMatchObject({ valid: false });
  });
});

// ---------------------------------------------------------------------------
// estimateDuration
// ---------------------------------------------------------------------------
describe('estimateDuration', () => {
  it('short messages complete in under 12 seconds', () => {
    // 80ms symbols + 3× APP_SIG preamble — overhead dominates for short messages
    expect(estimateDuration('Hi!')).toBeLessThan(12000);
  });

  it('longer messages take proportionally more time', () => {
    const short = estimateDuration('Hi!');
    const long  = estimateDuration('Hello, how are you doing today? Hope all is well.');
    expect(long).toBeGreaterThan(short);
  });

  it('280-char message transmission time is reasonable', () => {
    // 40ms symbols significantly increases transmission time
    expect(estimateDuration('a'.repeat(280))).toBeLessThan(80000);
  });

  it('always includes WAKE + END overhead (~800ms)', () => {
    // Even a 1-char message must be > 800ms (WAKE 500ms + END 300ms)
    expect(estimateDuration('a')).toBeGreaterThan(800);
  });
});

// ---------------------------------------------------------------------------
// assembleFrame
// ---------------------------------------------------------------------------
describe('assembleFrame', () => {
  const FAKE_UUID = 'a3d7f1c2'; // 8-char hex

  it('returns an array of bits (0s and 1s only)', () => {
    const bits = assembleFrame('Hello');
    expect(bits.every(b => b === 0 || b === 1)).toBe(true);
  });

  it('frame length grows with message length', () => {
    const short = assembleFrame('Hi');
    const long  = assembleFrame('Hello, this is a longer message!');
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('payload bits appear twice (NUM_COPIES = 2)', () => {
    const text = 'test';
    const payloadBits = huffmanEncode(text);
    const frame = assembleFrame(text);
    const frameStr = frame.join('');
    const payloadStr = payloadBits.join('');
    // The payload should appear at least twice in the frame
    const firstIdx  = frameStr.indexOf(payloadStr);
    const secondIdx = frameStr.indexOf(payloadStr, firstIdx + payloadStr.length);
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
  });

  it('broadcast frame has 32 bits of 1s for RECIPIENT_UUID', () => {
    // APP_SIG×3 = 72 bits, SYNC = 18 bits, SENDER_UUID = 32 bits → RECIPIENT at 122
    const frame = assembleFrame('hi');
    const recipientBits = frame.slice(122, 154);
    expect(recipientBits).toEqual(new Array(32).fill(1));
  });
});

// ---------------------------------------------------------------------------
// toSymbols
// ---------------------------------------------------------------------------
describe('toSymbols', () => {
  it('every symbol index is in range [0, 7]', () => {
    const bits = assembleFrame('Hello, world!');
    const symbols = toSymbols(bits);
    expect(symbols.every(s => s.lo >= 0 && s.lo <= 7)).toBe(true);
    expect(symbols.every(s => s.hi >= 0 && s.hi <= 7)).toBe(true);
  });

  it('4 bits → 1 symbol', () => {
    expect(toSymbols([0, 0, 0, 0])).toHaveLength(1);
    expect(toSymbols([1, 1, 1, 1])).toHaveLength(1);
  });

  it('pads to a multiple of 4', () => {
    // 5 bits should produce 2 symbols (padded to 8)
    expect(toSymbols([1, 0, 1, 0, 1])).toHaveLength(2);
  });

  it('maps 2-bit groups to correct indices (4-FSK)', () => {
    // [0,0, 0,0] → lo=0, hi=0
    expect(toSymbols([0,0, 0,0])[0]).toEqual({ lo: 0, hi: 0 });
    // [1,1, 1,1] → lo=3, hi=3
    expect(toSymbols([1,1, 1,1])[0]).toEqual({ lo: 3, hi: 3 });
    // [1,0, 0,1] → lo=2, hi=1
    expect(toSymbols([1,0, 0,1])[0]).toEqual({ lo: 2, hi: 1 });
  });
});
