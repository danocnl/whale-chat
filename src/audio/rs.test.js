import { describe, it, expect } from 'vitest';
import { rsEncode, rsDecode } from './rs.js';

const NSYM = 8;

describe('rsEncode', () => {
  it('returns data.length + nsym bytes', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    expect(rsEncode(data, NSYM).length).toBe(data.length + NSYM);
  });

  it('first k bytes are the original data (systematic)', () => {
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
    const cw = rsEncode(data, NSYM);
    expect([...cw.slice(0, data.length)]).toEqual([...data]);
  });
});

describe('rsDecode', () => {
  it('decodes a clean codeword with errors=0', () => {
    const data = new Uint8Array([10, 20, 30, 40, 50, 60]);
    const cw = rsEncode(data, NSYM);
    const { data: out, errors } = rsDecode(cw, NSYM);
    expect([...out]).toEqual([...data]);
    expect(errors).toBe(0);
  });

  it('corrects 1 byte error', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x12, 0x34]);
    const cw = new Uint8Array(rsEncode(data, NSYM));
    cw[2] ^= 0xff; // corrupt byte 2
    const { data: out, errors } = rsDecode(cw, NSYM);
    expect([...out]).toEqual([...data]);
    expect(errors).toBe(1);
  });

  it('corrects 2 byte errors', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const cw = new Uint8Array(rsEncode(data, NSYM));
    cw[0] ^= 0xab;
    cw[5] ^= 0xcd;
    const { data: out, errors } = rsDecode(cw, NSYM);
    expect([...out]).toEqual([...data]);
    expect(errors).toBe(2);
  });

  it('corrects 4 byte errors (maximum for nsym=8)', () => {
    const data = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x01, 0x02, 0x03]);
    const cw = new Uint8Array(rsEncode(data, NSYM));
    cw[0] ^= 0x11;
    cw[2] ^= 0x22;
    cw[5] ^= 0x33;
    cw[7] ^= 0x44;
    const { data: out, errors } = rsDecode(cw, NSYM);
    expect([...out]).toEqual([...data]);
    expect(errors).toBe(4);
  });

  it('throws on 5 errors (exceeds correction capability)', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const cw = new Uint8Array(rsEncode(data, NSYM));
    cw[0] ^= 0x11; cw[1] ^= 0x22; cw[2] ^= 0x33;
    cw[3] ^= 0x44; cw[4] ^= 0x55;
    expect(() => rsDecode(cw, NSYM)).toThrow();
  });

  it('round-trips a full message through encode+decode', () => {
    const msg = 'Hello, world!';
    const bytes = new TextEncoder().encode(msg);
    const cw = rsEncode(bytes, NSYM);
    const { data: out } = rsDecode(cw, NSYM);
    expect(new TextDecoder().decode(out)).toBe(msg);
  });
});
