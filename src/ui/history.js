import { getHistory, deleteFromHistory, clearHistory } from '../storage/store.js';

// TODO Phase 4: message history UI
export function renderHistory(navigate) {
  const el = document.createElement('div');
  el.innerHTML = `<p style="padding:2rem">History — coming in Phase 4</p>`;
  return el;
}
