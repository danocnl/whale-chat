import { getOrCreateUUID } from './storage/store.js';
import { renderCompose } from './ui/compose.js';
import { renderHistory } from './ui/history.js';
import { renderProfile } from './ui/profile.js';
import { renderContacts } from './ui/contacts.js';

const app = document.getElementById('app');

// Simple screen router — no library needed for 5 screens
const screens = {
  compose: renderCompose,
  history: renderHistory,
  profile: renderProfile,
  contacts: renderContacts,
};

export function navigate(screenName, params = {}) {
  const render = screens[screenName];
  if (!render) return;
  app.innerHTML = '';
  app.appendChild(render(navigate, params));
}

// Initialise — ensure UUID exists before anything renders
getOrCreateUUID();
navigate('compose');
