import { decodePayload } from '../audio/decoder.js';
import { resolveUUID, addToHistory } from '../storage/store.js';

// TODO Phase 4: incoming message prompt UI
// Called when decoder fires onIncoming with { senderUUID, isDirected, buffer }
export function renderPrompt(navigate, { senderUUID, isDirected, buffer }) {
  const el = document.createElement('div');
  el.innerHTML = `<p style="padding:2rem">Incoming prompt — coming in Phase 4</p>`;
  return el;
}
