import { getContacts, saveContact, deleteContact } from '../storage/store.js';

export function renderContacts(navigate) {
  const el = document.createElement('div');
  el.className = 'screen';

  let adding = false;

  function render() {
    const contacts = Object.entries(getContacts());

    el.innerHTML = `
      <div class="screen-header">
        <h1>Contacts</h1>
        <button class="btn btn-ghost" id="btn-toggle-add" style="padding:0 12px;height:34px;font-size:13px">
          ${adding ? 'Cancel' : '+ Add'}
        </button>
      </div>
      <div class="screen-body">

        ${adding ? `
          <div class="add-contact-form">
            <div>
              <input id="new-uuid" type="text" placeholder="UUID (8 hex chars)" maxlength="8"
                spellcheck="false" autocomplete="off" inputmode="text" />
              <div class="field-error" id="uuid-error"></div>
            </div>
            <div>
              <input id="new-name" type="text" placeholder="Nickname" maxlength="32" />
              <div class="field-error" id="name-error"></div>
            </div>
            <button class="btn btn-primary btn-full" id="btn-save-contact">Save contact</button>
          </div>
        ` : ''}

        ${contacts.length === 0 && !adding ? emptyState() : `
          <div class="thread-list">
            ${contacts.map(([uuid, name]) => contactRow(uuid, name)).join('')}
          </div>
        `}

      </div>
    `;

    el.querySelector('#btn-toggle-add').addEventListener('click', () => {
      adding = !adding;
      render();
    });

    if (adding) {
      const uuidInput  = el.querySelector('#new-uuid');
      const uuidError  = el.querySelector('#uuid-error');
      const nameInput  = el.querySelector('#new-name');
      const nameError  = el.querySelector('#name-error');
      const saveBtn    = el.querySelector('#btn-save-contact');
      uuidInput.focus();

      function validateUUID() {
        const val = uuidInput.value.trim().toLowerCase();
        if (!val) {
          uuidError.textContent = '';
          uuidInput.style.borderColor = '';
          return false;
        }
        if (/[^0-9a-f]/i.test(val)) {
          uuidError.textContent = 'Only hex characters (0–9, a–f) allowed';
          uuidInput.style.borderColor = 'var(--reject)';
          return false;
        }
        if (val.length < 8) {
          uuidError.textContent = `${8 - val.length} more character${8 - val.length !== 1 ? 's' : ''} needed`;
          uuidInput.style.borderColor = 'var(--reject)';
          return false;
        }
        if (getContacts()[val]) {
          uuidError.textContent = 'This UUID is already in your contacts';
          uuidInput.style.borderColor = 'var(--reject)';
          return false;
        }
        uuidError.textContent = '';
        uuidInput.style.borderColor = 'var(--accept)';
        return true;
      }

      function validateName() {
        const val = nameInput.value.trim();
        if (!val) {
          nameError.textContent = '';
          return false;
        }
        nameError.textContent = '';
        return true;
      }

      // Strip non-hex characters as user types
      uuidInput.addEventListener('input', () => {
        const raw = uuidInput.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 8);
        uuidInput.value = raw;
        validateUUID();
      });

      nameInput.addEventListener('input', validateName);

      el.querySelector('#btn-save-contact').addEventListener('click', () => {
        const uuidOk = validateUUID();
        const nameOk = validateName();
        if (!uuidOk) { uuidInput.focus(); return; }
        if (!nameOk) { nameError.textContent = 'Nickname is required'; nameInput.focus(); return; }
        saveContact(uuidInput.value.trim().toLowerCase(), nameInput.value.trim());
        adding = false;
        render();
      });

      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') saveBtn.click();
      });
    }

    el.querySelectorAll('.btn-del-contact').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteContact(btn.dataset.uuid);
        render();
      });
    });
  }

  render();
  return el;
}

function contactRow(uuid, name) {
  const initial = name.slice(0, 1).toUpperCase();
  return `
    <div class="thread-item" style="cursor:default">
      <div class="thread-avatar">${initial}</div>
      <div class="thread-body">
        <div class="thread-header-row">
          <span class="thread-name">${escHtml(name)}</span>
        </div>
        <div class="thread-preview">${uuid}</div>
      </div>
      <button class="btn-delete-thread btn-del-contact" data-uuid="${uuid}" title="Delete contact">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  `;
}

function emptyState() {
  return `
    <div class="empty-state">
      <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.5">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      <p>No contacts yet</p>
      <p style="font-size:13px">Tap "+ Add" to save a UUID</p>
    </div>
  `;
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
