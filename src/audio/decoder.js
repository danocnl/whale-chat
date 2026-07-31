import { decode as huffmanDecode } from './huffman.js';
import { verifyCRC } from './crc.js';
import { getShortUUID } from '../storage/store.js';

// Must match encoder constants exactly — see docs/SPEC.md
const SAMPLE_RATE = 44100;
const SYMBOL_DURATION_MS = 20;
const SYMBOL_SAMPLES = (SAMPLE_RATE * SYMBOL_DURATION_MS) / 1000; // 882

const LOW_BAND_FREQS  = [16000, 16250, 16500, 16750, 17000, 17250, 17500, 17750];
const HIGH_BAND_FREQS = [18000, 18250, 18500, 18750, 19000, 19250, 19500, 19750];

const WAKE_FREQ_LOW  = 17000;
const WAKE_FREQ_HIGH = 19000;
const APP_SIG = 0xA3D7F1;
const BROADCAST_UUID = 0xFFFFFFFF;

/**
 * Start listening for incoming transmissions.
 * Runs an FFT loop on mic input and calls onIncoming when a valid frame is detected.
 *
 * IMPORTANT: getUserMedia must disable AGC, noiseSuppression, echoCancellation.
 *
 * @param {function} onIncoming - Called with { senderUUID, isDirected, buffer }
 *   where buffer contains the raw decoded frame for deferred payload decoding
 * @returns {Promise<function>} Resolves with a stop() function to halt listening
 */
export async function startListening(onIncoming) {
  // TODO Phase 2:
  // 1. getUserMedia with AGC/NS/EC disabled, sampleRate 44100
  // 2. AnalyserNode + FFT loop (fftSize >= 2048)
  // 3. WAKE detection — sustained energy at WAKE_FREQ_LOW and WAKE_FREQ_HIGH
  // 4. APP_SIG verification
  // 5. SYNC lock for symbol boundary alignment
  // 6. Per-symbol tone identification across both sub-bands
  // 7. Frame field decoding (all header fields)
  // 8. RECIPIENT_UUID check — discard silently if directed to another device
  // 9. Buffer raw decoded bits for deferred payload decode on user accept
  // 10. Call onIncoming with senderUUID and buffer
  throw new Error('Not implemented');
}

/**
 * Decode a buffered payload after the user has accepted an incoming message.
 *
 * @param {object} buffer - Raw frame buffer from startListening
 * @returns {{ text: string, crcStatus: 'clean'|'recovered'|'corrupted' }}
 */
export function decodePayload(buffer) {
  // TODO Phase 2:
  // 1. Extract PAYLOAD_1 + CRC16_1 and PAYLOAD_2 + CRC16_2
  // 2. Verify CRC per copy
  // 3. Majority vote on mismatch
  // 4. Huffman decode → text
  // 5. Return text + crcStatus
  throw new Error('Not implemented');
}
