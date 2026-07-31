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
    console.log('[listen] stopped');
  } else {
    console.log('[listen] starting…');
    try {
      stopListening = await startListening(onIncoming);
      isListening   = true;
      console.log('[listen] active — mic open, waiting for WAKE signal');
    } catch (err) {
      console.error('[listen] failed to start:', err.message);
      return;
    }
  }
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

  // Mobile-only header — branding + listen toggle at the top
  app.appendChild(renderGlobalHeader());

  const screenEl = currentScreen === 'history'   ? renderHistory(navigate)
                 : currentScreen === 'compose'   ? renderCompose(navigate)
                 : currentScreen === 'contacts'  ? renderContacts(navigate)
                 : renderProfile(navigate);
  app.appendChild(screenEl);
  app.appendChild(renderNav());
}

// ── Global header (mobile only) ──────────────────────────────
function renderGlobalHeader() {
  const header = document.createElement('div');
  header.className = 'global-header';

  const brand = document.createElement('div');
  brand.className = 'global-header-brand';
  brand.innerHTML = `${navIconBat()}<span>Bat.Chat</span>`;
  header.appendChild(brand);

  const toggle = document.createElement('button');
  toggle.className = `listen-mic-toggle${isListening ? ' on' : ''}`;
  toggle.title = isListening ? 'Stop listening' : 'Start listening';
  toggle.innerHTML = `<div class="listen-mic-thumb">${isListening ? navIconMic() : navIconMicOff()}</div>`;
  toggle.addEventListener('click', toggleListening);
  header.appendChild(toggle);
  return header;
}

// ── Nav ──────────────────────────────────────────────────────
function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';

  // Brand — desktop sidebar only
  const brand = document.createElement('div');
  brand.className = 'nav-brand';
  brand.innerHTML = `${navIconBat()}<span>Bat.Chat</span>`;
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

  // Listen toggle — desktop sidebar only (pinned to bottom)
  const listenBtn = document.createElement('button');
  listenBtn.className = `listen-toggle${isListening ? ' listening' : ''}`;
  listenBtn.innerHTML = `
    ${navIconMic()}
    <span class="toggle-label">${isListening ? 'Listening' : 'Listen'}</span>
    <div class="toggle-switch${isListening ? ' on' : ''}"></div>
  `;
  listenBtn.addEventListener('click', toggleListening);
  nav.appendChild(listenBtn);

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
function navIconBat() {
  return `<svg viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path fill="currentColor" stroke="none" d="M9 11C7.5 10.5 4.5 11 1.5 9.5c.5 2.5 2.5 4 6 3.5 1.5-.2 2-1.5 1.5-2z"/>
    <path fill="currentColor" stroke="none" d="M15 11c1.5-.5 4.5 0 7.5-1.5-.5 2.5-2.5 4-6 3.5-1.5-.2-2-1.5-1.5-2z"/>
    <circle cx="12" cy="11" r="3" fill="currentColor" stroke="none"/>
    <polygon fill="currentColor" stroke="none" points="10,9 8.5,4.5 12.5,8.5"/>
    <polygon fill="currentColor" stroke="none" points="14,9 15.5,4.5 11.5,8.5"/>
    <path stroke-width="1.2" d="M8.5 16Q12 19 15.5 16"/>
    <path stroke-width="0.9" d="M6 19Q12 23 18 19"/>
    <path stroke-width="0.7" d="M3.5 22Q12 27 20.5 22"/>
  </svg>`;
}
function navIconMic() {
  return `<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}
function navIconMicOff() {
  return `<svg viewBox="0 0 24 24"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><path d="M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2"/><path d="M19 12v2a7 7 0 0 1-.09 1.09"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>`;
}

// ── Boot ─────────────────────────────────────────────────────
getOrCreateUUID();
initWelcome();
renderApp();

function initWelcome() {
  if (localStorage.getItem('bat_welcomed')) return;
  saveContact('batchat00', 'Bat.Chat');
  addToHistory({
    sender:    'batchat00',
    content:   'Welcome to Bat.Chat!\n\nSend and receive short text messages with people nearby using audio. No internet, no Bluetooth, no pairing required.',
    mode:      'broadcast',
    crcStatus: 'clean',
  });
  localStorage.setItem('bat_welcomed', '1');
}
