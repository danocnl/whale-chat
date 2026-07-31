/**
 * Decoder tests — written TDD-style ahead of Phase 2 implementation.
 *
 * Tests marked it.todo() will be implemented as each decoder piece is built.
 * Tests in active describe blocks are integration tests using synthetic FFT
 * data generated from known tone sequences.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Phase 2 — to be implemented (TDD)
// ---------------------------------------------------------------------------

describe('tone detection', () => {
  it.todo('identifies the correct low-band tone index from a synthetic FFT bin array');
  it.todo('identifies the correct high-band tone index from a synthetic FFT bin array');
  it.todo('returns null when no dominant tone is present (noise floor)');
  it.todo('handles tones at the edges of each sub-band');
});

describe('WAKE detection', () => {
  it.todo('triggers when sustained energy is present at 17kHz and 19kHz');
  it.todo('does not trigger on a single tone alone');
  it.todo('does not trigger on random broadband noise');
  it.todo('does not trigger when APP_SIG does not match');
});

describe('symbol boundary lock (SYNC)', () => {
  it.todo('locks symbol timing from the known SYNC bit pattern');
  it.todo('tolerates a small timing offset (< half symbol duration)');
});

describe('frame parsing', () => {
  it.todo('decodes SENDER_UUID correctly from known bit sequence');
  it.todo('decodes RECIPIENT_UUID = 0xFFFFFFFF as broadcast');
  it.todo('decodes directed RECIPIENT_UUID correctly');
  it.todo('decodes LENGTH field correctly');
  it.todo('silently discards frame when RECIPIENT_UUID does not match this device');
});

describe('decodePayload', () => {
  it.todo('returns clean text when both CRC copies pass');
  it.todo('returns text with mild warning when one copy passes and one fails CRC');
  it.todo('uses majority bit voting when copies differ');
  it.todo('returns corrupted status when both copies fail CRC');
});

describe('full round-trip (encoder → decoder)', () => {
  it.todo('decodes a broadcast message assembled by the encoder');
  it.todo('decodes a directed message addressed to this device');
  it.todo('silently discards a directed message addressed to another device');
  it.todo('correctly handles the maximum 280-char message');
});
