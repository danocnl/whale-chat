import { getOrCreateUUID, getShortUUID, getMyNickname, setMyNickname } from '../storage/store.js';

// TODO Phase 4: profile UI — UUID display, copy button, nickname
export function renderProfile(navigate) {
  const el = document.createElement('div');
  el.innerHTML = `<p style="padding:2rem">Profile — coming in Phase 4</p>`;
  return el;
}
