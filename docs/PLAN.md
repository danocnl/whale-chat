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

## Must Haves — Proves the concept works

### Phase 0 — Foundation

- [x] Confirm and scaffold tech stack — Vanilla JS + Vite (no framework)
- [x] UUID v4 generation on first launch, persisted to `localStorage`
- [x] Local storage layer — schema for UUID, history, contacts
- [x] CRC-16 utility (encode + verify)
- [ ] Static Huffman table (English-tuned, ~79 char set, encode + decode)

> **Notes:** Scaffolded manually (not via `npm create vite`) to preserve `docs/`. Build verified clean — 12 modules, 107ms. CRC-16/CCITT-FALSE implemented. UUID + storage layer complete. Huffman table is the remaining Phase 0 task.

---

### Phase 1 — TX Audio Engine

- [ ] Dual-band tone generation via `OscillatorNode` (16–18 kHz low, 18–20 kHz high)
- [ ] 8-FSK symbol mapping (8 tones per sub-band, 3 bits per symbol)
- [ ] 20ms symbol timing loop
- [ ] Character validation against allowed character set
- [ ] Huffman compression pipeline (text → bit stream)
- [ ] Frame assembly: WAKE → APP\_SIG → SYNC → SENDER\_UUID → RECIPIENT\_UUID → NUM\_COPIES → LENGTH → PAYLOAD\_1 → CRC16\_1 → PAYLOAD\_2 → CRC16\_2 → END
- [ ] Full transmission pipeline: text in → frame → audio out

> **Notes:** —

---

### Phase 2 — RX Audio Engine

> ⚠️ This is the highest-risk phase. Most development time will be spent here.

- [ ] `getUserMedia` with critical constraints (AGC, noise suppression, echo cancellation all disabled — see SPEC.md)
- [ ] `AnalyserNode` + FFT loop running continuously while app is in foreground
- [ ] WAKE signal detection (sustained energy at ~17 kHz and ~19 kHz)
- [ ] APP\_SIG verification (discard frame if constant does not match)
- [ ] Symbol boundary lock via SYNC sequence
- [ ] Per-symbol tone identification — which of 8 tones per sub-band each 20ms window
- [ ] Full frame parsing pipeline (all header fields)
- [ ] RECIPIENT\_UUID check — silently discard if directed to another device
- [ ] Buffer full audio from WAKE; decode payload only on user accept (Option B)
- [ ] Huffman decompression pipeline (bit stream → text)
- [ ] CRC-16 verification per payload copy
- [ ] Dual-copy comparison and majority voting on mismatch

> **Notes:** —

---

### Phase 3 — Integration & Testing

- [ ] Loopback test on single device (speaker → mic, same phone)
- [ ] Two-device test (basic broadcast, short message)
- [ ] Validate full round-trip: text in → audio → text out
- [ ] Test at range (across a room, ~3–5m)
- [ ] Confirm AGC/NS/EC constraints are working correctly (spectrogram check)

> **Notes:** —

---

### Phase 4 — Core UI

- [ ] Compose screen — text input, live character count, validation, send button
- [ ] Incoming prompt — sender UUID/nickname, accept/reject actions
- [ ] Message history — received messages, sender, timestamp, CRC status
- [ ] Profile screen — my UUID displayed large, copy to clipboard button

> **Notes:** —

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
