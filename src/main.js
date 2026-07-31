import { getOrCreateUUID, addToHistory, saveContact } from './storage/store.js';
import { startListening } from './audio/decoder.js';
import { renderCompose }  from './ui/compose.js';
import { renderHistory }  from './ui/history.js';
import { renderContacts } from './ui/contacts.js';
import { renderProfile }  from './ui/profile.js';
import { renderPrompt }   from './ui/prompt.js';

const app = document.getElementById('app');

// ── Listening state ──────────────────────────────────────────
let stopListening = null;
let isListening   = false;

async function toggleListening() {
  if (isListening) {
    stopListening?.();
    stopListening = null;
    isListening   = false;
  } else {
    try {
      stopListening = await startListening(onIncoming);
      isListening   = true;
    } catch (err) {
      console.warn('Could not start listener:', err.message);
      return;
    }
  }
  // Re-render so the Messages header and nav both reflect new state
  renderApp();
}

function onIncoming({ senderUUID, isDirected, frameBits }) {
  const modal = renderPrompt({ senderUUID, isDirected, frameBits }, () => {
    modal.remove();
  }, navigate);
  app.appendChild(modal);
}

// ── Router ───────────────────────────────────────────────────
let currentScreen = 'history';

export function navigate(screen) {
  currentScreen = screen;
  renderApp();
}

function renderApp() {
  app.innerHTML = '';

  const screenEl = currentScreen === 'history'   ? renderHistory(navigate, { isListening, toggleListening })
                 : currentScreen === 'compose'   ? renderCompose(navigate)
                 : currentScreen === 'contacts'  ? renderContacts(navigate)
                 : renderProfile(navigate);
  app.appendChild(screenEl);
  app.appendChild(renderNav());
}

function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';

  // Brand — desktop sidebar only
  const brand = document.createElement('div');
  brand.className = 'nav-brand';
  brand.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
    <span>Whale Chat</span>
  `;
  nav.appendChild(brand);

  const tabs = [
    { id: 'history',   label: 'Messages',  icon: navIconMessages(),  disabled: false },
    { id: 'compose',   label: 'Send',      icon: navIconSend(),      disabled: false },
    { id: 'contacts',  label: 'Contacts',  icon: navIconContacts(),  disabled: false },
    { id: 'templates', label: 'Templates', icon: navIconTemplates(), disabled: true  },
    { id: 'profile',   label: 'Profile',   icon: navIconProfile(),   disabled: false },
  ];

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = `nav-btn${currentScreen === tab.id ? ' active' : ''}${tab.disabled ? ' disabled' : ''}`;
    btn.innerHTML = `${tab.icon}<span>${tab.label}</span>`;
    if (!tab.disabled) btn.addEventListener('click', () => navigate(tab.id));
    nav.appendChild(btn);
  }

  return nav;
}

// ── SVG icons ────────────────────────────────────────────────
function navIconSend() {
  return `<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
}
function navIconMessages() {
  return `<svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`;
}
function navIconContacts() {
  return `<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
}
function navIconProfile() {
  return `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}
function navIconTemplates() {
  return `<svg viewBox="0 0 24 24"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
}
function navIconMic() {
  return `<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}

// ── Boot ─────────────────────────────────────────────────────
getOrCreateUUID();
initWelcome();
renderApp();

function initWelcome() {
  if (localStorage.getItem('whale_welcomed')) return;
  saveContact('whalecht', 'Whale Chat');
  addToHistory({
    sender:    'whalecht',
    content:   'Welcome to Whale Chat!\n\nSend and receive short text messages with people nearby using audio. No internet, no Bluetooth, no pairing required.',
    mode:      'broadcast',
    crcStatus: 'clean',
  });
  localStorage.setItem('whale_welcomed', '1');
}
