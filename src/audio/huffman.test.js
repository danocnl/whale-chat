import { describe, it, expect } from 'vitest';
import { encode, decode, encodedBitLength, tableStats } from './huffman.js';

describe('Huffman', () => {
  describe('round-trip', () => {
    it('simple string', () => {
      const text = 'hello';
      expect(decode(encode(text), text.length)).toBe(text);
    });

    it('mixed case and punctuation', () => {
      const text = 'Hello, World! How are you?';
      expect(decode(encode(text), text.length)).toBe(text);
    });

    it('all allowed punctuation', () => {
      const text = '.,!?\'"()-:;/@#_\n';
      expect(decode(encode(text), text.length)).toBe(text);
    });

    it('digits', () => {
      const text = '0123456789';
      expect(decode(encode(text), text.length)).toBe(text);
    });

    it('max length 280 chars', () => {
      const text = 'Hello world! '.repeat(22).slice(0, 280);
      expect(decode(encode(text), text.length)).toBe(text);
    });

    it('single character', () => {
      expect(decode(encode('a'), 1)).toBe('a');
    });

    it('single space', () => {
      expect(decode(encode(' '), 1)).toBe(' ');
    });
  });

  describe('compression', () => {
    it('space has the shortest code (most frequent)', () => {
      const stats = tableStats();
      const space = stats.find(s => s.char === ' ');
      expect(space.bits).toBeLessThanOrEqual(4);
    });

    it('compressed size is always smaller than raw', () => {
      const texts = [
        'the quick brown fox',
        'Hello, how are you today?',
        'Just a simple message.',
      ];
      for (const text of texts) {
        expect(encodedBitLength(text)).toBeLessThan(text.length * 8);
      }
    });

    it('typical English averages 4–6 bits per char', () => {
      const text = 'Hello, how are you doing today? I hope everything is well.';
      const bpc = encodedBitLength(text) / text.length;
      expect(bpc).toBeGreaterThan(3.5);
      expect(bpc).toBeLessThan(6.5);
    });
  });

  describe('error handling', () => {
    it('throws for characters outside the allowed set', () => {
      expect(() => encode('héllo')).toThrow();
    });

    it('throws for emoji', () => {
      expect(() => encode('hello 🎉')).toThrow();
    });
  });
});
