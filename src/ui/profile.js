import { getOrCreateUUID, getShortUUID } from '../storage/store.js';

export function renderProfile(navigate) {
  const el = document.createElement('div');
  el.className = 'screen';

  const fullUUID  = getOrCreateUUID();
  const shortUUID = getShortUUID();

  el.innerHTML = `
    <div class="screen-header">
      <h1>Profile</h1>
    </div>
    <div class="screen-body">
      <div class="profile-card">
        <svg class="profile-logo" viewBox="0 0 24 28" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <path fill="currentColor" stroke="none" d="M9 11C7.5 10.5 4.5 11 1.5 9.5c.5 2.5 2.5 4 6 3.5 1.5-.2 2-1.5 1.5-2z"/>
          <path fill="currentColor" stroke="none" d="M15 11c1.5-.5 4.5 0 7.5-1.5-.5 2.5-2.5 4-6 3.5-1.5-.2-2-1.5-1.5-2z"/>
          <circle cx="12" cy="11" r="3" fill="currentColor" stroke="none"/>
          <polygon fill="currentColor" stroke="none" points="10,9 8.5,4.5 12.5,8.5"/>
          <polygon fill="currentColor" stroke="none" points="14,9 15.5,4.5 11.5,8.5"/>
          <path stroke-width="1.2" d="M8.5 16Q12 19 15.5 16"/>
          <path stroke-width="0.9" d="M6 19Q12 23 18 19"/>
          <path stroke-width="0.7" d="M3.5 22Q12 27 20.5 22"/>
        </svg>
        <div class="uuid-display">${shortUUID}</div>
        <div class="uuid-full">${fullUUID}</div>
        <button class="btn btn-ghost" id="btn-copy" style="margin-top:4px">
          Copy UUID
        </button>
        <div class="copied-hint" id="copied-hint" style="opacity:0">Copied!</div>
      </div>
      <p style="font-size:13px;color:var(--muted);text-align:center;margin-top:12px;line-height:1.6">
        Share your UUID with others so they can<br>add you to their contacts.
      </p>
    </div>
  `;

  el.querySelector('#btn-copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(shortUUID).catch(() => {});
    const hint = el.querySelector('#copied-hint');
    hint.style.opacity = '1';
    setTimeout(() => { hint.style.opacity = '0'; }, 1500);
  });

  return el;
}
