const KEYS = {
  UUID: 'whale_uuid',
  NICKNAME: 'whale_nickname',
  CONTACTS: 'whale_contacts',
  HISTORY: 'whale_history',
};

// --- Identity ---

export function getOrCreateUUID() {
  let id = localStorage.getItem(KEYS.UUID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEYS.UUID, id);
  }
  return id;
}

export function getShortUUID() {
  return getOrCreateUUID().slice(0, 8);
}

export function getMyNickname() {
  return localStorage.getItem(KEYS.NICKNAME) || null;
}

export function setMyNickname(name) {
  localStorage.setItem(KEYS.NICKNAME, name.trim());
}

// --- Contacts ---

export function getContacts() {
  return JSON.parse(localStorage.getItem(KEYS.CONTACTS) || '{}');
}

export function saveContact(uuid, nickname) {
  const contacts = getContacts();
  contacts[uuid] = nickname.trim();
  localStorage.setItem(KEYS.CONTACTS, JSON.stringify(contacts));
}

export function deleteContact(uuid) {
  const contacts = getContacts();
  delete contacts[uuid];
  localStorage.setItem(KEYS.CONTACTS, JSON.stringify(contacts));
}

export function resolveUUID(uuid) {
  const contacts = getContacts();
  return contacts[uuid] || uuid.slice(0, 8);
}

// --- Message history ---

export function getHistory() {
  return JSON.parse(localStorage.getItem(KEYS.HISTORY) || '[]');
}

export function addToHistory(entry) {
  const history = getHistory();
  history.unshift({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    ...entry,
  });
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

export function deleteFromHistory(id) {
  const history = getHistory().filter(m => m.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

export function clearHistory() {
  localStorage.removeItem(KEYS.HISTORY);
}
