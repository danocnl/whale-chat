import { validateMessage, transmit, estimateDuration } from '../audio/encoder.js';
import { getContacts } from '../storage/store.js';
import { voiceSupported, showVoiceInput } from './voice-input.js';

const MAX = 280;

export function renderCompose(navigate) {
  const el = document.createElement('div');
  el.className = 'screen';

  el.innerHTML = `
    <div class="screen-header">
      <h1>Send</h1>
    </div>
    <div class="screen-body">
      <div class="compose-area">
        <div>
          <div class="textarea-wrap">
            <textarea id="msg-input" rows="5" placeholder="Type a message…" maxlength="${MAX}"
              style="${voiceSupported ? 'padding-right:44px' : ''}"></textarea>
            ${voiceSupported ? `
              <button class="btn-voice-float" id="btn-voice" title="Voice input">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            ` : ''}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
            <div class="error-msg" id="error-msg"></div>
            <div class="char-count" id="char-count">0 / ${MAX}</div>
          </div>
        </div>

        <div class="mode-toggle">
          <button id="btn-broadcast" class="active">Broadcast</button>
          <button id="btn-directed">Directed</button>
        </div>

        <div id="recipient-row" style="display:none">
          <input id="recipient-input" type="text" placeholder="Recipient UUID (8 hex chars)"
            maxlength="8" spellcheck="false" autocomplete="off" />
          <div id="recipient-hint" style="font-size:13px;color:var(--muted);margin-top:6px"></div>
        </div>

        <div class="duration-hint" id="duration-hint"></div>

        <div id="send-area">
          <button class="btn btn-primary btn-full" id="send-btn" disabled>Send</button>
        </div>

        <div class="send-progress" id="send-progress" style="display:none">
          <div class="progress-bar-wrap"><div class="progress-bar" id="progress-bar" style="width:0%"></div></div>
          <div class="progress-label" id="progress-label">Transmitting…</div>
        </div>
      </div>
    </div>
  `;

  const input        = el.querySelector('#msg-input');
  const charCount    = el.querySelector('#char-count');
  const errorMsg     = el.querySelector('#error-msg');
  const durationHint = el.querySelector('#duration-hint');
  const sendBtn      = el.querySelector('#send-btn');
  const sendArea     = el.querySelector('#send-area');
  const sendProgress = el.querySelector('#send-progress');
  const progressBar  = el.querySelector('#progress-bar');
  const progressLabel = el.querySelector('#progress-label');
  const btnBroadcast = el.querySelector('#btn-broadcast');
  const btnDirected  = el.querySelector('#btn-directed');
  const recipientRow = el.querySelector('#recipient-row');
  const recipientInput = el.querySelector('#recipient-input');
  const recipientHint  = el.querySelector('#recipient-hint');
  const listenBadge  = el.querySelector('#listen-badge');

  let mode      = 'broadcast'; // 'broadcast' | 'directed'
  let recipient = null;

  // ── Mode toggle ──────────────────────────────────────────
  btnBroadcast.addEventListener('click', () => {
    mode = 'broadcast';
    recipient = null;
    btnBroadcast.classList.add('active');
    btnDirected.classList.remove('active');
    recipientRow.style.display = 'none';
    update();
  });

  btnDirected.addEventListener('click', () => {
    mode = 'directed';
    btnDirected.classList.add('active');
    btnBroadcast.classList.remove('active');
    recipientRow.style.display = 'block';
    update();
  });

  // ── Recipient input ──────────────────────────────────────
  recipientInput.addEventListener('input', () => {
    const val = recipientInput.value.trim().toLowerCase();
    recipient = /^[0-9a-f]{8}$/.test(val) ? val : null;

    // Show contact name hint if known
    if (recipient) {
      const contacts = getContacts();
      recipientHint.textContent = contacts[recipient]
        ? `→ ${contacts[recipient]}`
        : 'Unknown contact';
    } else {
      recipientHint.textContent = val.length > 0 ? '8 hex characters required' : '';
    }
    update();
  });

  // ── Message input ────────────────────────────────────────
  input.addEventListener('input', () => update());

  function update() {
    const text = input.value;
    const len  = text.length;
    const { valid, error } = validateMessage(text);

    // Char count
    charCount.textContent = `${len} / ${MAX}`;
    charCount.classList.toggle('warn', len > MAX * 0.9);

    // Error
    errorMsg.textContent = text.length && !valid ? error : '';

    // Duration
    if (valid) {
      const ms = estimateDuration(text);
      durationHint.textContent = `~${(ms / 1000).toFixed(1)}s to transmit`;
    } else {
      durationHint.textContent = '';
    }

    // Recipient check
    const recipientOk = mode === 'broadcast' || recipient !== null;

    sendBtn.disabled = !valid || !recipientOk;
  }

  // ── Send ─────────────────────────────────────────────────
  sendBtn.addEventListener('click', async () => {
    const text = input.value;
    const { valid } = validateMessage(text);
    if (!valid) return;

    const duration = estimateDuration(text);
    const start    = Date.now();

    sendArea.style.display    = 'none';
    sendProgress.style.display = 'flex';

    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 99);
      progressBar.style.width = `${pct}%`;
      const remaining = Math.max(0, Math.round((duration - elapsed) / 1000));
      progressLabel.textContent = `Transmitting… ${remaining}s`;
    }, 100);

    try {
      await transmit(text, mode === 'directed' ? recipient : null);
      progressBar.style.width = '100%';
      progressLabel.textContent = 'Sent!';
      await pause(700);
      input.value = '';
      update();
    } catch (err) {
      progressLabel.textContent = `Error: ${err.message}`;
      await pause(1500);
    } finally {
      clearInterval(interval);
      progressBar.style.width = '0%';
      sendArea.style.display    = '';
      sendProgress.style.display = 'none';
    }
  });

  // ── Voice input ──────────────────────────────────────────
  el.querySelector('#btn-voice')?.addEventListener('click', () => {
    showVoiceInput(text => {
      input.value = text;
      update();
    });
  });

  update();
  return el;
}

const pause = ms => new Promise(r => setTimeout(r, ms));
