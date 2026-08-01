import { describe, it, expect, vi } from 'vitest';
import { validateMessage, estimateDuration, assembleFrame, toSymbols } from './encoder.js';
import { encode as huffmanEncode } from './huffman.js';

vi.stubGlobal('AudioContext', vi.fn(() => ({
  createOscillator: vi.fn(() => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: vi.fn() }, type: 'sine' })),
  createGain:       vi.fn(() => ({ connect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn() } })),
  createDynamicsCompressor: vi.fn(() => ({ connect: vi.fn(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } })),
  currentTime: 0, state: 'running',
  resume: vi.fn(() => Promise.resolve()), destination: {},
})));

// ── validateMessage ───────────────────────────────────────────
describe('validateMessage', () => {
  it('accepts plain English text', () => {
    expect(validateMessage('Hello, world!')).toEqual({ valid: true });
  });
  it('accepts all allowed characters', () => {
    expect(validateMessage('ABCabc 123 .,!?\'"()-:;/@#_\n')).toEqual({ valid: true });
  });
  it('rejects empty string',            () => expect(validateMessage('')).toMatchObject({ valid: false }));
  it('rejects text over 280 chars',     () => expect(validateMessage('a'.repeat(281))).toMatchObject({ valid: false }));
  it('accepts exactly 280 chars',       () => expect(validateMessage('a'.repeat(280))).toEqual({ valid: true }));
  it('rejects accented characters',     () => expect(validateMessage('héllo')).toMatchObject({ valid: false }));
  it('rejects emoji',                   () => expect(validateMessage('hi 🎉')).toMatchObject({ valid: false }));
  it('rejects null bytes',              () => expect(validateMessage('hi\0there')).toMatchObject({ valid: false }));
});

// ── estimateDuration ─────────────────────────────────────────
describe('estimateDuration', () => {
  it('short messages complete in under 12 seconds', () => {
    expect(estimateDuration('Hi!')).toBeLessThan(12000);
  });
  it('longer messages take proportionally more time', () => {
    expect(estimateDuration('Hello, how are you doing today?')).toBeGreaterThan(estimateDuration('Hi!'));
  });
  it('280-char message transmission time is reasonable', () => {
    expect(estimateDuration('a'.repeat(280))).toBeLessThan(80000);
  });
  it('always includes WAKE + END overhead', () => {
    expect(estimateDuration('a')).toBeGreaterThan(800);
  });
});

// ── assembleFrame ─────────────────────────────────────────────
describe('assembleFrame', () => {
  it('returns an array of bits (0s and 1s only)', () => {
    expect(assembleFrame('Hello').every(b => b === 0 || b === 1)).toBe(true);
  });
  it('frame length grows with message length', () => {
    expect(assembleFrame('Hello, this is a longer message!').length)
      .toBeGreaterThan(assembleFrame('Hi').length);
  });
  it('frame contains RS overhead (longer than raw huffman)', () => {
    const text = 'test';
    const frame = assembleFrame(text);
    const huffBits = huffmanEncode(text);
    // Must be longer than raw huffman alone (RS header + RS payload parity)
    expect(frame.length).toBeGreaterThan(48 + 18 + huffBits.length);
  });
  it('frame is an array of bits with at least APP_SIG + SYNC bits', () => {
    const frame = assembleFrame('hi');
    expect(frame.length).toBeGreaterThan(48 + 18);
  });
});

// ── toSymbols ─────────────────────────────────────────────────
describe('toSymbols', () => {
  it('every band index is in range [0, 3]', () => {
    const bits = assembleFrame('Hello, world!');
    const symbols = toSymbols(bits);
    expect(symbols.every(s => s.a >= 0 && s.a <= 3)).toBe(true);
    expect(symbols.every(s => s.b >= 0 && s.b <= 3)).toBe(true);
    expect(symbols.every(s => s.c >= 0 && s.c <= 3)).toBe(true);
    expect(symbols.every(s => s.d >= 0 && s.d <= 3)).toBe(true);
  });
  it('8 bits → 1 symbol', () => {
    expect(toSymbols([0,0,0,0, 0,0,0,0])).toHaveLength(1);
    expect(toSymbols([1,1,1,1, 1,1,1,1])).toHaveLength(1);
  });
  it('pads to multiple of 8', () => {
    // 9 bits → 2 symbols (padded to 16)
    expect(toSymbols(new Array(9).fill(0))).toHaveLength(2);
  });
  it('maps 2-bit groups to correct band indices', () => {
    // [00 00 00 00] → a=0, b=0, c=0, d=0
    expect(toSymbols([0,0, 0,0, 0,0, 0,0])[0]).toEqual({ a:0, b:0, c:0, d:0 });
    // [11 11 11 11] → a=3, b=3, c=3, d=3
    expect(toSymbols([1,1, 1,1, 1,1, 1,1])[0]).toEqual({ a:3, b:3, c:3, d:3 });
    // [10 01 11 00] → a=2, b=1, c=3, d=0
    expect(toSymbols([1,0, 0,1, 1,1, 0,0])[0]).toEqual({ a:2, b:1, c:3, d:0 });
  });
});
