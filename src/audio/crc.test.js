import { describe, it, expect } from 'vitest';
import { crc16, verifyCRC } from './crc.js';

describe('CRC-16', () => {
  it('returns a 16-bit value', () => {
    const crc = crc16([1, 0, 1, 0, 1, 0, 1, 0]);
    expect(crc).toBeGreaterThanOrEqual(0);
    expect(crc).toBeLessThanOrEqual(0xffff);
  });

  it('is deterministic — same input always produces same output', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    expect(crc16(bits)).toBe(crc16([...bits]));
  });

  it('different inputs produce different CRCs', () => {
    const a = [1, 0, 1, 0, 1, 0, 1, 0];
    const b = [0, 1, 0, 1, 0, 1, 0, 1];
    expect(crc16(a)).not.toBe(crc16(b));
  });

  it('verifyCRC passes on matching CRC', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0];
    expect(verifyCRC(bits, crc16(bits))).toBe(true);
  });

  it('verifyCRC fails when a single bit is flipped', () => {
    const bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0];
    const crc = crc16(bits);
    bits[0] ^= 1;
    expect(verifyCRC(bits, crc)).toBe(false);
  });

  it('verifyCRC fails with wrong CRC value', () => {
    const bits = [1, 0, 1, 0, 1, 0, 1, 0];
    const crc = crc16(bits);
    expect(verifyCRC(bits, crc ^ 0x0001)).toBe(false);
  });

  it('handles an empty bit array', () => {
    expect(() => crc16([])).not.toThrow();
  });
});
