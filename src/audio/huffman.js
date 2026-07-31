// Static Huffman table — English-tuned, ~79 character set
// Both encoder and decoder use this shared table (no header transmitted)
// TODO Phase 0: Build full table from English character frequency data
// Average: ~4.5 bits/char | Worst case: ~7 bits/char

export const HUFFMAN_TABLE = {
  // placeholder — full table to be implemented in Phase 0
};

/**
 * Encode a validated text string into a bit array using the static Huffman table.
 * @param {string} text - Pre-validated input (allowed chars only)
 * @returns {number[]} Array of bits (0s and 1s)
 */
export function encode(text) {
  // TODO Phase 0
  throw new Error('Not implemented');
}

/**
 * Decode a bit array back into a string using the static Huffman tree.
 * @param {number[]} bits - Bit array from the received payload
 * @param {number} charCount - Expected number of characters (from LENGTH field)
 * @returns {string} Decoded text
 */
export function decode(bits, charCount) {
  // TODO Phase 0
  throw new Error('Not implemented');
}
