/**
 * Static Huffman coding — English-tuned for messaging text.
 *
 * The tree is built once at module load from fixed frequency weights,
 * so it is always identical on both sender and receiver.
 * No table is transmitted — zero header overhead.
 *
 * Allowed character set (~79 chars): A-Z, a-z, 0-9, space,
 * and: . , ! ? ' " ( ) - : ; / @ # _ \n
 *
 * Average: ~4.5 bits/char for typical English messaging text.
 * Worst case (rare chars): ~11 bits/char.
 */

// ---------------------------------------------------------------------------
// Character frequency weights
// Tuned for English messaging text. Higher = shorter code.
// ---------------------------------------------------------------------------

const CHAR_FREQUENCIES = {
  // Space — most common character in written English
  ' ':  18000,

  // Lowercase letters — standard English corpus frequencies (scaled ×100)
  'e': 12702, 't':  9056, 'a':  8167, 'o':  7507, 'i':  6966,
  'n':  6749, 's':  6327, 'h':  6094, 'r':  5987, 'd':  4253,
  'l':  4025, 'c':  2782, 'u':  2758, 'm':  2406, 'w':  2360,
  'f':  2228, 'g':  2015, 'y':  1974, 'p':  1929, 'b':  1492,
  'v':   978, 'k':   772, 'j':   153, 'x':   150, 'q':    95,
  'z':    74,

  // Uppercase — ~12% of lowercase (sentence starts, proper nouns)
  'T':  1086, 'A':   980, 'I':   956, 'S':   759, 'W':   708,
  'H':   731, 'O':   901, 'B':   448, 'C':   500, 'D':   510,
  'E':   762, 'F':   400, 'G':   362, 'J':   275, 'K':   231,
  'L':   483, 'M':   433, 'N':   810, 'P':   347, 'R':   718,
  'U':   331, 'V':   176, 'X':    60, 'Y':   355, 'Q':    57,
  'Z':    57,

  // Digits — messaging-appropriate (dates, numbers, codes)
  '1':   500, '2':   450, '0':   420, '3':   380, '5':   360,
  '4':   330, '9':   310, '6':   290, '7':   280, '8':   275,

  // Punctuation — weighted for messaging context
  '.':   700,  // sentence endings
  ',':   600,  // most common punctuation
  "'":   450,  // apostrophes: don't, I'm, it's
  '!':   400,  // common in messaging
  '?':   350,  // questions
  '-':   250,  // dashes, hyphens
  '"':   200,  // quotes
  '\n':  200,  // newlines in multi-line messages
  ':':   150,  // time, ratios
  '(':   120,  // parentheses
  ')':   120,
  '/':   100,  // dates, fractions
  ';':    85,  // semicolons
  '@':    75,  // email, mentions
  '#':    60,  // hashtags
  '_':    55,  // underscores (usernames, filenames)
};

// ---------------------------------------------------------------------------
// Tree builder — runs once at module load
// ---------------------------------------------------------------------------

function buildTree(freqs) {
  let nodes = Object.entries(freqs).map(([char, freq]) => ({
    char,
    freq,
    left: null,
    right: null,
  }));

  while (nodes.length > 1) {
    nodes.sort((a, b) => a.freq - b.freq || a.char?.localeCompare(b.char));
    const left = nodes.shift();
    const right = nodes.shift();
    nodes.push({
      char: null,
      freq: left.freq + right.freq,
      left,
      right,
    });
  }

  return nodes[0];
}

function generateEncodeTable(root) {
  const table = {};

  function walk(node, code) {
    if (node.char !== null) {
      table[node.char] = code || '0';
      return;
    }
    walk(node.left, code + '0');
    walk(node.right, code + '1');
  }

  walk(root, '');
  return table;
}

// Built once, reused for every encode/decode operation
const TREE = buildTree(CHAR_FREQUENCIES);
const ENCODE_TABLE = generateEncodeTable(TREE);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a validated text string into a bit array.
 * @param {string} text - Pre-validated (allowed chars only)
 * @returns {number[]} Array of bits (0s and 1s)
 */
export function encode(text) {
  const bits = [];
  for (const char of text) {
    const code = ENCODE_TABLE[char];
    if (code === undefined) throw new Error(`Character not in Huffman table: ${JSON.stringify(char)}`);
    for (const bit of code) bits.push(Number(bit));
  }
  return bits;
}

/**
 * Decode a bit array back into text.
 * @param {number[]} bits - Bit array from received payload
 * @param {number} charCount - Expected character count (from LENGTH frame field)
 * @returns {string} Decoded text
 */
export function decode(bits, charCount) {
  const chars = [];
  let node = TREE;

  for (const bit of bits) {
    node = bit === 0 ? node.left : node.right;
    if (!node) throw new Error('Invalid Huffman bit sequence — possible corruption');

    if (node.char !== null) {
      chars.push(node.char);
      node = TREE;
      if (chars.length === charCount) break;
    }
  }

  if (chars.length !== charCount) {
    throw new Error(`Huffman decode: expected ${charCount} chars, got ${chars.length}`);
  }

  return chars.join('');
}

/**
 * Return the compressed bit length for a given string.
 * Useful for estimating transmission time before sending.
 * @param {string} text
 * @returns {number} Number of bits in the compressed output
 */
export function encodedBitLength(text) {
  return [...text].reduce((total, char) => {
    return total + (ENCODE_TABLE[char]?.length ?? 8);
  }, 0);
}

/**
 * Decode exactly charCount characters from a bit array, returning both the
 * decoded text and the number of bits consumed. Used by the decoder to locate
 * the CRC-16 that follows each payload copy without knowing the bit length upfront.
 *
 * @param {number[]} bits
 * @param {number} charCount
 * @returns {{ text: string, bitsConsumed: number }}
 */
export function decodeWithLength(bits, charCount) {
  const chars = [];
  let node = TREE;
  let i = 0;

  for (; i < bits.length && chars.length < charCount; i++) {
    node = bits[i] === 0 ? node.left : node.right;
    if (!node) throw new Error('Invalid Huffman bit sequence — possible corruption');
    if (node.char !== null) {
      chars.push(node.char);
      node = TREE;
    }
  }

  return { text: chars.join(''), bitsConsumed: i };
}

/**
 * Return the code table sorted by code length — useful for debugging.
 * @returns {Array<{ char: string, bits: number, code: string }>}
 */
export function tableStats() {
  return Object.entries(ENCODE_TABLE)
    .map(([char, code]) => ({ char, bits: code.length, code }))
    .sort((a, b) => a.bits - b.bits || a.char.localeCompare(b.char));
}
