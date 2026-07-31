import { validateMessage, transmit } from '../audio/encoder.js';

// TODO Phase 4: full compose UI
export function renderCompose(navigate) {
  const el = document.createElement('div');
  el.innerHTML = `<p style="padding:2rem">Compose — coming in Phase 4</p>`;
  return el;
}
