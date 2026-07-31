import {
  getHistory, deleteFromHistory, resolveUUID, saveContact, getContacts,
} from '../storage/store.js';
import { showConfirm } from './confirm.js';

export function renderHistory(navigate, listenProps = {}) {
  const el = document.createElement('div');
  el.className = 'screen';

  const { isListening = false, toggleListening = null } = listenProps;

  // Internal view state
  let view         = 'threads'; // 'threads' | 'thread'
  let activeSender = null;

  function render() {
    const history = getHistory();

    if (view === 'threads') {
      renderThreadList(history);
    } else {
      renderThreadDetail(history, activeSender);
    }
  }

  // ── Thread list ────────────────────────────────────────────
  function renderThreadList(history) {
    const threads = groupBySender(history);

    el.innerHTML = `
      <div class="screen-header">
        <h1>Messages</h1>
        ${toggleListening ? `
          <button class="listen-toggle-header${isListening ? ' listening' : ''}" id="btn-listen-toggle">
            <span>${isListening ? 'Listening' : 'Listen'}</span>
            <div class="toggle-switch${isListening ? ' on' : ''}"></div>
          </button>
        ` : ''}
      </div>
      <div class="screen-body">
        ${threads.length === 0 ? `
          ${emptyState()}
        ` : `
          <div class="thread-list">
            ${threads.map(t => threadItem(t)).join('')}
          </div>
        `}
      </div>
    `;

    el.querySelector('#btn-listen-toggle')?.addEventListener('click', () => toggleListening?.());


    el.querySelectorAll('.btn-delete-thread').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const sender   = btn.dataset.sender;
        const name     = resolveUUID(sender);
        const messages = getHistory().filter(m => m.sender === sender);
        const ok = await showConfirm({
          message: `Delete all ${messages.length} message${messages.length !== 1 ? 's' : ''} from ${name}?`,
        });
        if (ok) { messages.forEach(m => deleteFromHistory(m.id)); render(); }
      });
    });

    el.querySelectorAll('.thread-item').forEach(item => {
      item.addEventListener('click', () => {
        activeSender = item.dataset.sender;
        view = 'thread';
        render();
      });
    });
  }

  // ── Thread detail ──────────────────────────────────────────
  function renderThreadDetail(history, sender) {
    const messages  = history
      .filter(m => m.sender === sender)
      .reverse(); // oldest first for chronological reading
    const name      = resolveUUID(sender);
    const isKnown   = getContacts()[sender] !== undefined;

    el.innerHTML = `
      <div class="screen-header">
        <button class="btn-back" id="btn-back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style="flex:1;min-width:0">
          <h1 style="font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</h1>
          <div style="font-size:12px;color:var(--muted);font-family:monospace;margin-top:1px">${sender}</div>
        </div>
        ${!isKnown ? `<button class="btn btn-ghost" id="btn-add-contact" style="padding:0 12px;height:34px;font-size:13px;flex-shrink:0">+ Contact</button>` : ''}
      </div>
      <div class="screen-body">
        ${messages.length === 0 ? '<p style="color:var(--muted);font-size:14px">No messages</p>' : `
          <div class="message-thread">
            ${messages.map(m => messageItem(m)).join('')}
          </div>
        `}
      </div>
    `;

    el.querySelector('#btn-back').addEventListener('click', () => {
      view = 'threads';
      activeSender = null;
      render();
    });

    el.querySelector('#btn-add-contact')?.addEventListener('click', () => {
      const nick = prompt(`Nickname for ${sender}:`);
      if (nick?.trim()) {
        saveContact(sender, nick.trim());
        render();
      }
    });

    el.querySelectorAll('.btn-delete-msg').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteFromHistory(btn.dataset.id);
        const remaining = getHistory().filter(m => m.sender === sender);
        if (remaining.length === 0) {
          view = 'threads';
          activeSender = null;
        }
        render();
      });
    });
  }

  render();
  return el;
}

// ── Helpers ────────────────────────────────────────────────────
function groupBySender(history) {
  const map = {};
  for (const msg of history) {
    if (!map[msg.sender]) map[msg.sender] = [];
    map[msg.sender].push(msg);
  }
  // Each group sorted newest-first (history already is), return groups sorted by latest message
  return Object.entries(map)
    .map(([sender, messages]) => ({ sender, messages }))
    .sort((a, b) => b.messages[0].timestamp - a.messages[0].timestamp);
}

function threadItem({ sender, messages }) {
  const name    = resolveUUID(sender);
  const latest  = messages[0];
  const preview = latest.content.replace(/\n/g, ' ').slice(0, 60) + (latest.content.length > 60 ? '…' : '');
  const count   = messages.length;
  const ts      = formatTime(latest.timestamp);

  return `
    <div class="thread-item" data-sender="${sender}">
      <div class="thread-avatar">${name.slice(0, 1).toUpperCase()}</div>
      <div class="thread-body">
        <div class="thread-header-row">
          <span class="thread-name">${escHtml(name)}</span>
        </div>
        <div class="thread-preview">${escHtml(preview)}</div>
        <div class="thread-meta">
          <span class="thread-count">${count} message${count !== 1 ? 's' : ''}</span>
          ${latest.crcStatus !== 'clean' ? `<span class="crc-badge ${latest.crcStatus}">${latest.crcStatus}</span>` : ''}
          ${latest.mode === 'directed' ? `<span class="crc-badge directed">Directed</span>` : ''}
        </div>
      </div>
      <div class="thread-actions">
        <span class="thread-ts">${ts}</span>
        <button class="btn-delete-thread" data-sender="${sender}" title="Delete thread">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
        <svg class="thread-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
    </div>
  `;
}

function messageItem(m) {
  const ts       = formatTimeFull(m.timestamp);
  const crcLabel = m.crcStatus === 'clean' ? 'Clean' : m.crcStatus === 'recovered' ? 'Recovered' : 'Corrupted';

  return `
    <div class="message-item">
      <div class="message-bubble">
        <div class="message-body">
          <div class="message-meta">
            <span class="crc-badge ${m.crcStatus}">${crcLabel}</span>
            <span class="timestamp">${ts}</span>
            ${m.mode === 'directed' ? `<span class="crc-badge directed">Directed</span>` : ''}
          </div>
          <div class="message-content">${escHtml(m.content)}</div>
        </div>
        <button class="btn-delete-msg btn-delete-thread" data-id="${m.id}" title="Delete message">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function emptyState() {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <p>No messages yet</p>
      <p style="font-size:13px">Accepted messages will appear here</p>
    </div>
  `;
}

function formatTime(ts) {
  const d = new Date(ts), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatTimeFull(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

