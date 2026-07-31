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
        <div class="uuid-display">${shortUUID}</div>
        <div class="uuid-full">${fullUUID}</div>
        <button class="btn btn-ghost" id="btn-copy" style="margin-top:4px">
          Copy UUID
        </button>
        <div class="copied-hint" id="copied-hint" style="opacity:0"> Copied!</div>
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
