# Whale Chat — Protocol & Application Specification

> **Status:** Design / Pre-implementation  
> **Version:** 0.1.0

---

## Overview

Whale Chat is a proof-of-concept web application that transfers short text messages between smartphones using near-ultrasonic audio signals (16–20 kHz). No internet connection, Bluetooth pairing, or central server is required. Communication is entirely local and acoustic.

### Design Goals

- Broadcast-style transmission audible only to devices running the app
- Simple one-way text messaging with optional directed (unicast) addressing
- All data stored locally on-device — no accounts, no cloud
- Foreground-only for POC; background support out of scope for now
- No sensitive data — the channel is open by design

---

## Frequency Band

| Parameter | Value |
|---|---|
| Low sub-band | 16.0–18.0 kHz |
| High sub-band | 18.0–20.0 kHz |
| Total bandwidth | 4 kHz |

**Rationale:** This range was selected over the originally considered 18.5–21.5 kHz for two reasons:

1. **Speaker output power** — smartphone speakers roll off significantly above 15 kHz. 16–20 kHz produces meaningfully more acoustic power than 18.5–21.5 kHz, improving range and SNR.
2. **Directionality** — lower frequencies have longer wavelengths relative to the speaker size, producing wider dispersion. Room reflections further mitigate directionality for indoor broadcast use.

The range remains inaudible to most adults. Young people with excellent hearing may perceive a faint hiss during transmission.

---

## Modulation

### Dual-Band 8-FSK

Each sub-band independently carries an 8-FSK signal (8 distinct tones = 3 bits per symbol). Both sub-bands transmit simultaneously, yielding **6 bits per symbol period**.

| Parameter | Value |
|---|---|
| Tones per sub-band | 8 |
| Bits per sub-band per symbol | 3 |
| Combined bits per symbol | 6 |
| Symbol duration | 20ms |
| Raw throughput | 300 bps |
| Effective throughput (with overhead) | ~255 bps |

### Tone Spacing

With 8 tones across each 2 kHz sub-band, tone spacing is approximately **250 Hz**. At 44.1 kHz sample rate with 20ms symbols (882 samples), FFT resolution is ~50 Hz — well below the tone spacing, ensuring reliable discrimination.

---

## Compression

### Static Huffman Coding

Text is compressed using a pre-agreed static Huffman table tuned for English character frequency. Both sender and receiver share the same table at build time — **no table is transmitted** with the message, so there is zero compression header overhead.

| Metric | Value |
|---|---|
| Average bits per character | ~4.5 bits |
| Worst case (rare characters) | ~7 bits |
| Typical compression ratio | ~44% reduction vs raw ASCII |

### Character Set

Only the following characters are permitted in a message payload. Any other character is rejected at the compose stage before transmission.

```
A–Z  a–z  0–9  (space)  . , ! ? ' " ( ) - : ; / @ # _  (newline)
```

Total: ~79 characters. This closed set means the Huffman table is complete with no escape codes required.

### Message Limit

Maximum message length: **280 characters** (Twitter-style cap).

---

## Frame Structure

### Overview

```
[WAKE][APP_SIG][SYNC][SENDER_UUID][RECIPIENT_UUID][NUM_COPIES][LENGTH][PAYLOAD_1][CRC16_1][PAYLOAD_2][CRC16_2][END]
```

### Component Breakdown

#### 1. WAKE — 500ms

Two sustained tones held simultaneously at the centre of each sub-band:

- Low sub-band centre: ~17.0 kHz
- High sub-band centre: ~19.0 kHz

This signals all listening devices that a transmission is incoming. It is not an FSK data symbol — it is a distinct, easily detectable pattern that cannot be confused with data.

#### 2. APP_SIG — 80ms (~4 symbols)

A fixed 24-bit application signature transmitted as FSK symbols immediately after WAKE. Only frames bearing this exact constant are processed; all others are discarded.

- Prevents coincidental triggering from other apps or systems using the same frequency band
- Not a security mechanism — the constant is part of the open protocol spec
- Adds ~80ms overhead at negligible cost

#### 3. SYNC — 60ms (~3 symbols)

A known bit sequence transmitted after APP_SIG to allow the decoder to calibrate symbol boundary timing before data arrives.

#### 4. SENDER_UUID — 120ms (~6 symbols)

The sender's device identifier: **32 bits (8 hex characters)**.

- Decoded immediately on receipt and displayed to the user before any payload is decoded
- Displayed as the 8-char short form (e.g. `a3d7f1c2`); shown with nickname if one is saved

#### 5. RECIPIENT_UUID — 120ms (~6 symbols)

The intended recipient's device identifier: **32 bits**.

| Value | Meaning |
|---|---|
| `0xFFFFFFFF` | Broadcast — all devices prompt the user |
| Any other value | Directed — only the matching device prompts; all others silently discard |

This is a UX/routing mechanism only. It does not encrypt or secure the payload — any device can still decode a directed message.

#### 6. NUM_COPIES — ~27ms (~1–2 symbols)

An 8-bit field indicating how many payload copies follow. Set to `2` for the current POC. Allows the protocol to be extended to support 1 or 3 copies in future without a breaking change.

#### 7. LENGTH — 60ms (~3 symbols)

A 16-bit field representing the **character count** of the original (pre-compression) message (0–280). The decoder uses this to know when to stop emitting characters from the Huffman bit stream.

#### 8. PAYLOAD + CRC-16 (repeated NUM_COPIES times)

Each copy consists of:

- **PAYLOAD** — Huffman-compressed message bits (variable length)
- **CRC-16** — 16-bit cyclic redundancy check computed over the compressed payload bits (~60ms)

The payload is transmitted NUM_COPIES times (currently 2) to enable corruption detection and recovery.

**Receiver logic:**

| Copy 1 CRC | Copy 2 CRC | Action |
|---|---|---|
| Pass | Pass | Use either copy |
| Pass | Fail | Use Copy 1, mild warning |
| Fail | Pass | Use Copy 2, mild warning |
| Fail | Fail | Display corruption warning, request resend |

If both copies arrive but differ at the bit level, majority voting is applied bit-by-bit.

#### 9. END — 300ms

Mirror of the WAKE signal — the same two sustained tones held for 300ms. Signals clean transmission completion. Shorter than WAKE as the receiver is already locked in.

---

## Transmission Modes

### Broadcast Mode

`RECIPIENT_UUID = 0xFFFFFFFF`

The default mode. All devices in range running the app will receive the incoming prompt.

### Directed Mode

`RECIPIENT_UUID = <target 8-char UUID>`

Only the device whose UUID matches the RECIPIENT_UUID will be prompted. All other devices silently discard the frame after decoding RECIPIENT_UUID.

The sender selects a recipient from their local contact book, or enters a UUID manually.

---

## Transmission Time Reference

Fixed overhead per frame (sent once regardless of message length):

| Component | Duration |
|---|---|
| WAKE | 500ms |
| APP_SIG | 80ms |
| SYNC | 60ms |
| SENDER_UUID | 120ms |
| RECIPIENT_UUID | 120ms |
| NUM_COPIES | 27ms |
| LENGTH | 60ms |
| END | 300ms |
| **Fixed total** | **1,267ms** |

Total transmission time (2× payload):

| Message length | Payload × 2 + CRC × 2 | **Total** |
|---|---|---|
| 50 chars | ~1,640ms | **~3.0s** |
| 100 chars | ~3,120ms | **~4.4s** |
| 140 chars | ~4,320ms | **~5.6s** |
| 280 chars | ~8,520ms | **~9.8s** |

---

## Acknowledgement System

After transmitting the END signal, the sender switches to receive mode and listens for ACK frames from devices that accepted the message.

### ACK Frame

Each accepting device transmits a compact acknowledgement frame:

```
[ACK_WAKE: 200ms][APP_SIG: 80ms][RECEIVER_UUID: 32 bits][CRC-8: 8 bits][ACK_END: 150ms]
```

Total ACK duration: ~620ms per device.

ACK_WAKE uses a **200ms** sustained tone (vs 500ms for the main WAKE), allowing the sender in listening mode to distinguish incoming ACKs from new messages.

### UUID-Derived TDMA Delay

To minimise collisions when multiple devices ACK simultaneously, each device calculates a deterministic transmission delay from its own UUID:

```javascript
function getAckDelay(uuid) {
  const lastTwoBytes = parseInt(uuid.slice(-4), 16); // 0–65535
  const slot = lastTwoBytes % 1500;                  // 0–1499
  return slot * 20;                                  // 0–29,980ms
}
```

| Parameter | Value |
|---|---|
| Total slots | 1,500 |
| Slot duration | 20ms |
| Total ACK window | 30 seconds |
| Collision probability (10 devices) | ~3.0% |
| Collision probability (20 devices) | ~11.9% |

The sender collects all ACK UUIDs received within the 30-second window and displays the delivery receipt (e.g. "Received by Alice, Bob").

---

## Audio Constraints — Critical

> The following constraints **must** be applied on every microphone request. Failure to do so will result in the OS or browser filtering and corrupting the FSK signal.

```javascript
navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    sampleRate: 44100
  }
})
```

| Constraint | Reason |
|---|---|
| `echoCancellation: false` | Echo cancellation actively suppresses high-frequency repetitive signals |
| `noiseSuppression: false` | Noise suppression treats near-ultrasonic tones as artefacts to remove |
| `autoGainControl: false` | AGC normalises amplitude, corrupting FSK which relies on frequency not amplitude |
| `sampleRate: 44100` | Ensures Nyquist limit of 22.05 kHz, safely above our 20 kHz upper band |

---

## Application Screens

### 1. Compose

- Text input with live character count (max 280)
- Validation: only permitted characters accepted
- Toggle: Broadcast (default) / Directed
- Directed mode: recipient selector — pick from contacts or enter UUID manually
- Send button triggers full frame transmission

### 2. Incoming Prompt

Shown when a WAKE → APP_SIG → SYNC sequence is detected and RECIPIENT_UUID matches this device (or is broadcast).

- Displays: sender nickname (if known) or raw UUID
- Displays: transmission mode (Broadcast / Directed to you)
- Actions: Accept / Reject
- On Accept: decodes buffered payload, checks CRC, displays message
- On Reject: discards buffer silently

### 3. Message History

- Chronological log of all accepted messages
- Per entry: sender nickname/UUID, message content, timestamp, delivery mode
- Option to delete individual entries or clear all
- All data stored locally — never synced or uploaded
- Tap an unknown UUID → shortcut to add as contact

### 4. Profile

- My UUID displayed prominently (large, readable)
- One-tap copy to clipboard
- Set my display nickname (stored locally)
- Share my UUID (system share sheet)

### 5. Contacts

- List of saved UUID → nickname mappings
- Add contact: enter UUID + nickname
- Edit / delete contacts
- Contacts used for: directed send recipient picker, incoming message display, delivery receipt display

---

## Local Storage Schema

```javascript
// Device identity
'whale_uuid'     → string   // UUID v4, generated once on first launch
'whale_nickname' → string   // optional display name for this device

// Contact book
'whale_contacts' → JSON {
  [uuid: string]: string    // uuid → nickname
}

// Message history
'whale_history'  → JSON [
  {
    id:        string,      // local message ID
    sender:    string,      // sender UUID
    content:   string,      // decoded message text
    timestamp: number,      // Unix ms
    mode:      'broadcast' | 'directed',
    crcStatus: 'clean' | 'recovered' | 'corrupted'
  }
]
```

---

## Implementation Notes

- **Platform:** Web app (Web Audio API) — targets iOS Safari and Android Chrome
- **TX engine:** `OscillatorNode` for tone generation
- **RX engine:** `AnalyserNode` with FFT for tone detection
- **App must be in foreground** — mobile browsers suspend audio processing when backgrounded (acceptable for POC)
- **UUID generation:** `crypto.randomUUID()` on first launch, persisted to localStorage
- **No backend** — no server, no accounts, no network requests
