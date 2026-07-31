/**
 * Voice-to-text input with double-confirmation.
 *
 * Guides the user through two recording rounds and compares the
 * transcriptions before accepting — same redundancy principle as
 * the double-payload protocol.
 *
 * Uses the Web Speech API (Chrome, Safari iOS 15+, Edge).
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

// Only keep characters in our allowed set
const ALLOWED_RE = /[^A-Za-z0-9 .,!?'"()\-:;/@#_\n]/g;
const sanitize  = t => t.replace(ALLOWED_RE, '').replace(/\s+/g, ' ').trim();
const normalize = t => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * @param {function} onConfirm - Called with the final confirmed text
 */
export function showVoiceInput(onConfirm) {
  if (!SR) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  document.getElementById('app').appendChild(backdrop);

  let rec     = null;
  let results = ['', ''];

  function close() {
    rec?.abort();
    backdrop.remove();
  }

  function mount(html) {
    backdrop.innerHTML = `<div class="modal-sheet voice-sheet"><div class="modal-pill"></div>${html}</div>`;
    backdrop.querySelector('.js-close')?.addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  }

  // ── Recording round ──────────────────────────────────────
  function startRound(n) {
    mount(`
      <div class="voice-label">Round ${n} of 2</div>
      <div class="voice-heading">${n === 1 ? 'Say your message' : 'Say it again to confirm'}</div>
      <div class="voice-interim" id="vt-interim">Listening…</div>
      <div class="voice-indicator"><div class="voice-dot"></div></div>
      <div class="modal-actions">
        <button class="btn btn-ghost js-close" style="flex:1">Cancel</button>
      </div>
    `);

    rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';

    let final = '';

    rec.onresult = e => {
      let interim = '';
      for (const r of e.results) {
        if (r.isFinal) final += r[0].transcript;
        else           interim += r[0].transcript;
      }
      const el = backdrop.querySelector('#vt-interim');
      if (el) el.textContent = sanitize(final + interim) || 'Listening…';
    };

    rec.onend = () => {
      results[n - 1] = sanitize(final);
      n === 1 ? showBetween() : showResult();
    };

    rec.onerror = e => {
      if (e.error === 'no-speech') {
        results[n - 1] = '';
        n === 1 ? showBetween() : showResult();
      } else {
        mount(`
          <div class="voice-heading">Microphone error</div>
          <div class="voice-interim">${e.error}</div>
          <div class="modal-actions">
            <button class="btn btn-ghost js-close" style="flex:1">Cancel</button>
            <button class="btn btn-primary js-retry" style="flex:1">Try again</button>
          </div>
        `);
        backdrop.querySelector('.js-retry')?.addEventListener('click', () => startRound(1));
      }
    };

    rec.start();
  }

  // ── Between rounds ───────────────────────────────────────
  function showBetween() {
    const text = results[0];
    if (!text) {
      mount(`
        <div class="voice-label">Round 1 complete</div>
        <div class="voice-heading">Nothing heard</div>
        <div class="voice-interim">Make sure your microphone is on and speak clearly.</div>
        <div class="modal-actions">
          <button class="btn btn-ghost js-close" style="flex:1">Cancel</button>
          <button class="btn btn-primary js-retry" style="flex:1">Try again</button>
        </div>
      `);
      backdrop.querySelector('.js-retry')?.addEventListener('click', () => startRound(1));
      return;
    }

    mount(`
      <div class="voice-label">Round 1 complete</div>
      <div class="voice-result">"${escHtml(text)}"</div>
      <div class="voice-heading" style="font-size:15px">Now say it again to confirm</div>
      <div class="modal-actions">
        <button class="btn btn-ghost js-close" style="flex:1">Cancel</button>
        <button class="btn btn-primary js-next" style="flex:1">Continue</button>
      </div>
    `);
    backdrop.querySelector('.js-next')?.addEventListener('click', () => startRound(2));
  }

  // ── Final comparison ─────────────────────────────────────
  function showResult() {
    const [t1, t2] = results;
    const matched  = normalize(t1) === normalize(t2);

    if (matched && t1) {
      mount(`
        <div class="voice-match-icon">✓</div>
        <div class="voice-label">Match confirmed</div>
        <div class="voice-result">"${escHtml(t1)}"</div>
        <div class="modal-actions">
          <button class="btn btn-ghost js-close" style="flex:1">Cancel</button>
          <button class="btn btn-primary js-use" style="flex:1">Use this</button>
        </div>
      `);
      backdrop.querySelector('.js-use')?.addEventListener('click', () => { onConfirm(t1); close(); });
    } else {
      mount(`
        <div class="voice-label">Transcriptions didn't match</div>
        <div class="voice-mismatch">
          <div class="voice-mismatch-row"><span class="vm-n">1</span><span>"${escHtml(t1 || '(nothing heard)')}"</span></div>
          <div class="voice-mismatch-row"><span class="vm-n">2</span><span>"${escHtml(t2 || '(nothing heard)')}"</span></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost js-retry-all" style="flex:1">Try again</button>
        </div>
        <div class="modal-actions" style="margin-top:0">
          ${t1 ? `<button class="btn btn-ghost js-use1" style="flex:1">Use round 1</button>` : ''}
          ${t2 ? `<button class="btn btn-ghost js-use2" style="flex:1">Use round 2</button>` : ''}
        </div>
        <button class="btn btn-ghost js-close" style="width:100%;margin-top:4px;color:var(--muted)">Cancel</button>
      `);
      backdrop.querySelector('.js-retry-all')?.addEventListener('click', () => { results = ['', '']; startRound(1); });
      backdrop.querySelector('.js-use1')?.addEventListener('click', () => { onConfirm(t1); close(); });
      backdrop.querySelector('.js-use2')?.addEventListener('click', () => { onConfirm(t2); close(); });
    }
  }

  startRound(1);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
