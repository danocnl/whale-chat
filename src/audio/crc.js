// CRC-16/CCITT-FALSE — standard polynomial 0x1021
// Computed over the compressed payload bit array, verified per copy

const POLY = 0x1021;
const INIT = 0xFFFF;

/**
 * Compute CRC-16 over an array of bits.
 * @param {number[]} bits
 * @returns {number} 16-bit CRC value
 */
export function crc16(bits) {
  // Pack bits into bytes (pad to byte boundary with zeros)
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] ?? 0);
    }
    bytes.push(byte);
  }

  let crc = INIT;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ POLY : crc << 1;
      crc &= 0xFFFF;
    }
  }
  return crc;
}

/**
 * Verify a received bit array against a CRC value.
 * @param {number[]} bits
 * @param {number} expected - CRC-16 value decoded from the frame
 * @returns {boolean}
 */
export function verifyCRC(bits, expected) {
  return crc16(bits) === expected;
}
