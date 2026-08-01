import { getContacts, saveContact, deleteContact } from '../storage/store.js';
import { showToast } from './toast.js';

export function renderContacts(navigate) {
  const el = document.createElement('div');
  el.className = 'screen';

  let adding = false;
  let editingUuid = null;

  function render() {
    const contacts = Object.entries(getContacts()).sort(([, a], [, b]) => a.localeCompare(b));

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
            ${contacts.map(([uuid, name]) => contactRow(uuid, name, uuid === editingUuid)).join('')}
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

    el.querySelectorAll('.btn-copy-uuid').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard.writeText(btn.dataset.uuid).catch(() => {});
        showToast('UUID copied');
      });
    });

    el.querySelectorAll('.btn-dm-contact').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        navigate('compose', { recipient: btn.dataset.uuid });
      });
    });

    el.querySelectorAll('.btn-edit-contact').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        editingUuid = btn.dataset.uuid;
        render();
        el.querySelector('.contact-edit-input')?.focus();
      });
    });

    el.querySelectorAll('.btn-cancel-edit').forEach(btn => {
      btn.addEventListener('click', () => { editingUuid = null; render(); });
    });

    el.querySelectorAll('.btn-save-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = el.querySelector('.contact-edit-input');
        const newName = input?.value.trim();
        if (newName) { saveContact(btn.dataset.uuid, newName); }
        editingUuid = null;
        render();
      });
    });

    el.querySelectorAll('.contact-edit-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') el.querySelector('.btn-save-edit')?.click();
        if (e.key === 'Escape') el.querySelector('.btn-cancel-edit')?.click();
      });
    });
  }

  render();
  return el;
}

function contactRow(uuid, name, editing) {
  const iconEdit  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  const iconTrash = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
  const iconCopy  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const iconDM    = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  if (editing) {
    return `
      <div class="thread-item contact-editing" style="cursor:default;align-items:center">
        <div class="thread-body">
          <input class="contact-edit-input" value="${escHtml(name)}" maxlength="32"
            style="margin-bottom:4px;padding:6px 10px;font-size:14px;font-weight:600" />
          <div class="thread-preview" style="padding-left:2px">${uuid}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-primary btn-save-edit" data-uuid="${uuid}"
            style="padding:0 14px;height:32px;font-size:13px">Save</button>
          <button class="btn btn-ghost btn-cancel-edit"
            style="padding:0 12px;height:32px;font-size:13px">Cancel</button>
        </div>
      </div>
    `;
  }

  return `
    <div class="thread-item" style="cursor:default;align-items:center">
      <div class="thread-body">
        <div class="thread-header-row">
          <span class="thread-name">${escHtml(name)}</span>
        </div>
        <div class="thread-preview">${uuid}</div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button class="btn-delete-thread btn-dm-contact" data-uuid="${uuid}" title="Send direct message">
          ${iconDM}
        </button>
        <button class="btn-delete-thread btn-copy-uuid" data-uuid="${uuid}" title="Copy UUID">
          ${iconCopy}
        </button>
        <button class="btn-delete-thread btn-edit-contact" data-uuid="${uuid}" title="Edit nickname">
          ${iconEdit}
        </button>
        <button class="btn-delete-thread btn-del-contact" data-uuid="${uuid}" title="Delete contact">
          ${iconTrash}
        </button>
      </div>
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
