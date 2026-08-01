/**
 * Show a custom text-input modal.
 * Returns a Promise<string|null> — the trimmed value, or null if cancelled.
 */
export function showPromptModal({ title, placeholder = '', confirmLabel = 'Save', cancelLabel = 'Cancel' }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    backdrop.innerHTML = `
      <div class="modal-sheet confirm-sheet">
        <div class="modal-pill"></div>
        <p class="confirm-message">${title}</p>
        <input id="prompt-input" type="text" placeholder="${placeholder}"
          style="margin-bottom:4px" autocomplete="off" spellcheck="false"/>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirm-cancel" style="flex:1">${cancelLabel}</button>
          <button class="btn btn-accept" id="confirm-ok" style="flex:1">${confirmLabel}</button>
        </div>
      </div>
    `;

    function close(value) {
      backdrop.remove();
      resolve(value);
    }

    const input = backdrop.querySelector('#prompt-input');
    backdrop.querySelector('#confirm-cancel').addEventListener('click', () => close(null));
    backdrop.querySelector('#confirm-ok').addEventListener('click', () => {
      const val = input.value.trim();
      if (val) close(val);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const val = input.value.trim(); if (val) close(val); }
      if (e.key === 'Escape') close(null);
    });
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(null); });

    document.getElementById('app').appendChild(backdrop);
    input.focus();
  });
}

/**
 * Show a custom confirmation modal.
 * Returns a Promise<boolean> — true if confirmed, false if cancelled.
 *
 * @param {{ message: string, confirmLabel?: string, cancelLabel?: string }} opts
 */
export function showConfirm({ message, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    backdrop.innerHTML = `
      <div class="modal-sheet confirm-sheet">
        <div class="modal-pill"></div>
        <p class="confirm-message">${message}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirm-cancel" style="flex:1">${cancelLabel}</button>
          <button class="btn btn-danger" id="confirm-ok" style="flex:1">${confirmLabel}</button>
        </div>
      </div>
    `;

    function close(result) {
      backdrop.remove();
      resolve(result);
    }

    backdrop.querySelector('#confirm-cancel').addEventListener('click', () => close(false));
    backdrop.querySelector('#confirm-ok').addEventListener('click',     () => close(true));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false); });

    document.getElementById('app').appendChild(backdrop);
    // Focus the cancel button so Escape / Enter are accessible
    backdrop.querySelector('#confirm-cancel').focus();
  });
}
