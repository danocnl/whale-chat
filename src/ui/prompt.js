import { decodePayload } from '../audio/decoder.js';
import { resolveUUID, addToHistory } from '../storage/store.js';

/**
 * Render the incoming message modal overlay.
 * Appears on top of whatever screen is currently active.
 *
 * @param {{ senderUUID, isDirected, frameBits }} incoming
 * @param {function} onClose - Called when modal should be removed
 */
export function renderPrompt({ senderUUID, isDirected, frameBits }, onClose, navigate) {
  const senderName = resolveUUID(senderUUID);
  const isKnown    = senderName !== senderUUID.slice(0, 8);

  const el = document.createElement('div');
  el.className = 'modal-backdrop';

  el.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-pill"></div>
      <div class="modal-title">Incoming message</div>

      <div class="modal-sender">
        <div class="modal-sender-name">${isKnown ? senderName : senderUUID}</div>
        ${isKnown ? `<div class="modal-sender-uuid">${senderUUID}</div>` : ''}
        <div style="margin-top:6px">
          <span class="modal-sender-badge">
            ${isDirected
              ? `<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Directed to you`
              : `<svg width="12" height="12" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg> Broadcast`}
          </span>
        </div>
      </div>

      <div class="modal-preview" id="modal-preview">Decoding…</div>

      <div class="modal-actions">
        <button class="btn btn-reject" id="btn-reject">Reject</button>
        <button class="btn btn-accept" id="btn-accept">Accept</button>
      </div>
    </div>
  `;

  const preview   = el.querySelector('#modal-preview');
  const btnAccept = el.querySelector('#btn-accept');
  const btnReject = el.querySelector('#btn-reject');

  // Decode immediately so the user can see a preview
  let decoded;
  try {
    decoded = decodePayload(frameBits);
    const short = decoded.text.length > 60
      ? decoded.text.slice(0, 60) + '…'
      : decoded.text;
    preview.textContent = `"${short}"`;
  } catch {
    decoded = null;
    preview.textContent = '(Unable to preview — may be corrupted)';
  }

  btnReject.addEventListener('click', onClose);

  btnAccept.addEventListener('click', () => {
    if (decoded) {
      addToHistory({
        sender:    senderUUID,
        content:   decoded.text,
        mode:      isDirected ? 'directed' : 'broadcast',
        crcStatus: decoded.crcStatus,
      });
    }
    onClose();
    navigate?.('history');
  });

  // Tap backdrop to reject
  el.addEventListener('click', e => {
    if (e.target === el) onClose();
  });

  return el;
}
