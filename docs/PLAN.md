# Whale Chat — Implementation Plan

> This file is updated with every commit. Status reflects the current state of the codebase.
> Reference `docs/SPEC.md` for full protocol and application specification.

## Status Key

| Symbol | Meaning |
|---|---|
| `- [ ]` | Not started |
| `- [x]` | Complete |
| `⏳` | In progress |
| `🔴` | Blocked |

---

## Testing

- `npm test` — run full suite (Vitest, happy-dom environment)
- `npm run test:watch` — watch mode during development
- Test files live alongside source as `*.test.js`
- All commits must pass `npm test` before pushing
- Phase 2 decoder tests written TDD-style ahead of implementation (`it.todo`)

---

## Must Haves — Proves the concept works

### Phase 0 — Foundation

- [x] Confirm and scaffold tech stack — Vanilla JS + Vite (no framework)
- [x] UUID v4 generation on first launch, persisted to `localStorage`
- [x] Local storage layer — schema for UUID, history, contacts
- [x] CRC-16 utility (encode + verify)
- [x] Static Huffman table (English-tuned, ~79 char set, encode + decode)

> **Notes:** Scaffolded manually (not via `npm create vite`) to preserve `docs/`. Build verified clean — 12 modules, 107ms. CRC-16/CCITT-FALSE implemented. UUID + storage layer complete. Huffman table built dynamically from fixed English frequency weights — tree is always identical on sender and receiver. Round-trip verified on multiple realistic samples. Actual bits/char: 4.6–5.3 for typical messaging text (spec estimated 4.5 — slightly optimistic due to capitals/punctuation, but transmission times remain valid). Phase 0 complete.

---

### Phase 1 — TX Audio Engine

- [x] Dual-band tone generation via `OscillatorNode` (16–18 kHz low, 18–20 kHz high)
- [x] 8-FSK symbol mapping (8 tones per sub-band, 3 bits per symbol)
- [x] 20ms symbol timing loop
- [x] Character validation against allowed character set
- [x] Huffman compression pipeline (text → bit stream)
- [x] Frame assembly: WAKE → APP\_SIG → SYNC → SENDER\_UUID → RECIPIENT\_UUID → NUM\_COPIES → LENGTH → PAYLOAD\_1 → CRC16\_1 → PAYLOAD\_2 → CRC16\_2 → END
- [x] Full transmission pipeline: text in → frame → audio out

> **Notes:** All frequency scheduling done against `AudioContext.currentTime` (not setTimeout) for sample-accurate, drift-free symbol timing. Signal chain: two OscillatorNode (sine) → individual GainNode (0.5 each) → master GainNode (0.8) → speakers. WAKE + END use sustained tones at sub-band centres (17 kHz, 19 kHz); data symbols switch frequencies via `setValueAtTime`. `estimateDuration()` exported for UI progress indicator. Frame assembly and symbol conversion tested in Node — all symbol indices valid [0–7], payload bits verified in correct frame position. Audio playback requires browser (AudioContext not available in Node). Phase 1 complete.

---

### Phase 2 — RX Audio Engine

- [x] `getUserMedia` with critical constraints (AGC, noise suppression, echo cancellation all disabled — see SPEC.md)
- [x] `AnalyserNode` + FFT loop running continuously while app is in foreground
- [x] WAKE signal detection (sustained energy at ~17 kHz and ~19 kHz)
- [x] APP\_SIG verification (discard frame if constant does not match)
- [x] Symbol boundary lock via SYNC sequence
- [x] Per-symbol tone identification — which of 8 tones per sub-band each 20ms window
- [x] Full frame parsing pipeline (all header fields)
- [x] RECIPIENT\_UUID check — silently discard if directed to another device
- [x] Buffer full audio from WAKE; decode payload only on user accept (Option B)
- [x] Huffman decompression pipeline (bit stream → text)
- [x] CRC-16 verification per payload copy
- [x] Dual-copy comparison and majority voting on mismatch

> **Notes:** Pure functions (identifyToneIndex, isWakePresent, symbolsToBits, bitsToNum, parseHeader, decodePayload) fully tested with synthetic FFT data — 98 tests passing. State machine: IDLE → WAKING (≥400ms sustained WAKE tones) → RECEIVING (accumulate symbols) → IDLE (END tones trigger frame processing). `smoothingTimeConstant = 0` on AnalyserNode for instantaneous FFT values. Drift-corrected 20ms loop via requestAnimationFrame. decodePayload handles clean / recovered (one copy bad) / corrupted (both bad, majority vote) cases. decodeWithLength added to huffman.js — returns bitsConsumed so decoder can locate copy 2 without knowing payload bit length upfront. 2 remaining todos: live mic tests (browser only). Phase 2 complete.

---

### Phase 3 — Integration & Testing

- [x] Loopback test on single device (speaker → mic, same phone)
- [x] Two-device test (phone → phone broadcast, short message)
- [x] Validate full round-trip: text in → audio → text out
- [ ] Test at range (across a room, ~3–5m)
- [ ] Confirm AGC/NS/EC constraints are working correctly (spectrogram check)

> **Notes:** Phone-to-phone bidirectional communication confirmed working. Laptop self-reception (speaker→own mic) confirmed clean. Phone receiving laptop transmission showed corruption — diagnosed as room echoes (multipath) causing burst errors across consecutive symbols. Multiple copies do not help with burst errors since all copies are affected by the same echo. Fixed with Reed-Solomon FEC (see below). Final protocol configuration:
> - **Modulation**: 4-FSK dual-band, 80ms symbols, 4 bits/symbol = ~50 bps effective
> - **Frequency bands**: 4–8 kHz (was 10–20 kHz — phone speakers too weak above 9 kHz for cross-device pickup)
> - **WAKE**: 3000 Hz / 8500 Hz (outside data bands, no FFT leakage)
> - **Threshold**: -70 dBFS (WAKE signal −22 to −36 dBFS; data leakage −86 to −130 dBFS)
> - **Symbol duration**: 80ms — 1024-point FFT window (23ms) covers <29% of symbol; dramatically reduces inter-symbol contamination vs 40ms (57%) or 20ms (115%)
> - **Redundancy**: 3 copies of payload — enables true 2-of-3 majority voting; effective BER drops from ~15% to ~6%
> - **APP_SIG**: 3× preamble repetition with fuzzy search (≤3 bit errors); decoder aligns to last occurrence
> - **Key lesson**: errors are timing-driven (sampling phase vs symbol boundary), not purely random — longer symbols are the most impactful reliability improvement
> - **FEC note**: Reed-Solomon error correction would be the correct long-term fix for pushing reliability above 95%; current 3-copy majority voting is a practical approximation

---

### Phase 3b — Reliability: Reed-Solomon FEC

- [x] Replace 2-copy redundancy + CRC-16 with Reed-Solomon FEC (GF(256), nsym=8)
- [x] Mute RX pipeline during TX (prevents self-reception on transmitting device)
- [x] Remove NUM_COPIES header field, replace with DATA_K (Huffman byte count pre-parity)
- [x] RS corrects up to 4 byte errors per frame in any positions — handles burst errors from room echoes

> **Why RS over copies:** Multiple copies protect against random, uncorrelated bit errors. Room echoes
> produce burst errors — a 200–500ms reflection corrupts a contiguous chunk of symbols, affecting all
> copies equally. Reed-Solomon corrects any pattern of up to ⌊nsym/2⌋ byte errors regardless of
> position. With nsym=8 and 80ms/symbol, RS handles echoes lasting up to ~640ms. Interleaving was
> considered but is unnecessary for single-codeword frames — RS corrects scattered and burst errors
> equally. Transmission time also improves: 1 copy + RS overhead < 2 copies for typical message lengths.
> **Algorithm:** Berlekamp-Massey (error locator) + Chien search (error positions) + Vandermonde
> Gaussian elimination (error magnitudes). Primitive polynomial: x^8+x^4+x^3+x^2+1 = 0x11D.

---

### Phase 4 — Core UI

- [x] Compose screen — text input, live character count, validation, send button, broadcast/directed toggle, progress bar
- [x] Incoming prompt — sender UUID/nickname, accept/reject, decode on accept, tap-backdrop to dismiss
- [x] Message history — threaded by sender, expand to conversation, delete thread or individual message, directed badge
- [x] Profile screen — UUID display, one-tap copy
- [x] Contacts screen — add/edit/delete UUID→nickname, styled like Messages
- [x] Responsive layout — bottom nav (mobile) / sidebar (desktop ≥640px)
- [x] Listen toggle — manual mic start/stop in Messages header, persists across nav
- [x] Custom confirm modal — replaces browser prompt for destructive actions
- [x] Welcome message on first launch

> **Notes:** Directed mode UI (Phase 5) already implemented in the compose screen. Contacts/nickname resolution (Phase 6) also complete. Both folded into Phase 4 during UI build.

---

## Should Haves — Makes it actually usable

### Phase 5 — Directed Mode

- [ ] RECIPIENT\_UUID field handling in TX pipeline (broadcast `0xFFFFFFFF` vs directed)
- [ ] RECIPIENT\_UUID check in RX pipeline (silent discard if not for this device)
- [ ] Compose UI: broadcast/directed toggle
- [ ] Compose UI: recipient input (manual UUID entry)
- [ ] Compose UI: recipient selector from contacts list

> **Notes:** —

---

### Phase 6 — Contacts & Nicknames

- [ ] Contact book CRUD — add, edit, delete UUID → nickname mappings
- [ ] Nickname resolution — display nickname wherever UUID appears (history, prompt, receipts)
- [ ] "Add to contacts" shortcut from message history on unknown UUID
- [ ] Own nickname — user can set a local display name for themselves (shown on Profile)

> **Notes:** —

---

## Nice to Haves — Polish and extra features

### Phase 7 — ACK System

- [ ] Sender switches to RX mode after END signal for 30-second window
- [ ] Receiver transmits ACK frame after user accepts (mini frame: ACK\_WAKE + UUID + CRC-8)
- [ ] UUID-derived TDMA delay (last 2 bytes of UUID mod 1500 × 20ms)
- [ ] Sender collects ACK UUIDs and resolves to nicknames where known
- [ ] Delivery receipt display on sent message ("Received by Alice, Bob")

> **Notes:** —

---

### Phase 8 — UX Polish

- [ ] Share my UUID via system share sheet
- [ ] Corruption warning state on received message (CRC mismatch)
- [ ] Empty states (no messages yet, no contacts)
- [ ] Loading/transmitting indicator during send
- [ ] Receiving indicator while buffering
- [ ] Mobile-optimised layout and touch targets
- [ ] App name / branding (name TBD)

> **Notes:** —

---

### Phase 9 — Template / Preset Messages

> **Context:** Key use case is security/logistics teams sending encoded messages over tannoy/PA systems. Input speed is critical. Templates allow one-tap dispatch of pre-approved message codes without composing from scratch.

- [ ] Template management screen (CRUD — add, edit, delete, reorder)
- [ ] Templates section in desktop sidebar (placeholder added, disabled for now)
- [ ] One-tap send from template list (bypasses compose screen entirely)
- [ ] Template categories / grouping (e.g. "All clear", "Alert", "Logistics")
- [ ] Pin frequently used templates to top

> **Notes:** Sidebar placeholder added in Phase 4 UI. Full implementation deferred — this is the highest-value feature for the tannoy/PA use case.

---

## Future Considerations

> Items noted for future review — not scheduled, no implementation started.

**Auto-start listener on app open**
Currently the listen toggle is manual. For field operatives who are primarily receivers, auto-starting on app open (with a permission prompt on first launch) would reduce friction. Requires careful handling of iOS AudioContext policy and battery implications.

**Message length limit review**
The 280 character cap was chosen for reasonable transmission time (~10s worst case). In the tannoy use case, messages are likely much shorter (10–50 chars for coded messages). Consider a configurable limit or a "quick mode" with a tighter cap and faster transmission.
