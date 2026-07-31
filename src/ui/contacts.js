import { getContacts, saveContact, deleteContact, resolveUUID } from '../storage/store.js';

// TODO Phase 6: contacts UI — list, add, edit, delete UUID→nickname mappings
export function renderContacts(navigate) {
  const el = document.createElement('div');
  el.innerHTML = `<p style="padding:2rem">Contacts — coming in Phase 6</p>`;
  return el;
}
