import { resetAllGardens } from '../garden/economy.js';
import { CURRENCY } from '../runtime/currency.js';
// Persistent debug/settings surface: a bug-icon FAB (bottom-right) that opens a settings dialog,
// plus a version tag below it. Replaces the old inline "debug" menu on the home page.
import { DB, saveDB } from '../runtime/db.js';
import { route } from '../runtime/router.js';
import { S } from '../runtime/state.js';

/** Add the version tag + bug FAB to <body> once, at boot (persist across page renders). */
export function mountDebug(): void {
  const ver = document.createElement('div');
  ver.className = 'vertag';
  ver.textContent = __APP_VERSION__;
  document.body.appendChild(ver);

  const btn = document.createElement('button');
  btn.className = 'debugfab';
  btn.id = 'debugfab';
  btn.title = 'Debug & settings';
  btn.textContent = '🪲';
  btn.addEventListener('click', openDebugDialog);
  document.body.appendChild(btn);
}

function closeDebugDialog(): void {
  const o = document.getElementById('debugov');
  if (o) o.remove();
}

function openDebugDialog(): void {
  closeDebugDialog();
  const ov = document.createElement('div');
  ov.id = 'debugov';
  ov.className = 'pauseov';
  ov.innerHTML = `<div class="pausebox" style="text-align:left;min-width:330px">
    <div class="pausetitle" style="font-size:21px;margin-bottom:2px">🪲 Debug &amp; settings</div>
    <div class="tiny" style="margin-bottom:16px">The Cloud Developer Quiz · ${__APP_VERSION__}</div>
    <label class="dbgrow"><span>Infinite money</span><input type="checkbox" id="dbg-inf" ${DB.infinite ? 'checked' : ''}></label>
    <label class="dbgrow"><span>Show garden tile IDs <span class="tiny">sprite index · water bitmask</span></span><input type="checkbox" id="dbg-tiles" ${S.showTileIds ? 'checked' : ''}></label>
    <div class="dbgrow"><span>Export save file <span class="tiny">full backup — quiz history, notes, gardens, ${CURRENCY.many}</span></span><button class="btn ghost sm" id="dbg-json">⬇ Download JSON</button></div>
    <div class="dbgrow"><span>Reset all garden progress <span class="tiny">removes extra gardens, backgrounds, ${CURRENCY.many} &amp; unlocks</span></span><button class="btn bad sm" id="dbg-reset">Reset all</button></div>
    <div class="actions center" style="margin-top:18px"><button class="btn primary" id="dbg-close">Done</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closeDebugDialog();
  });
  ov.querySelector('#dbg-inf')!.addEventListener('change', (e) => {
    DB.infinite = (e.target as HTMLInputElement).checked;
    saveDB();
    route(); // re-render current page so coin displays update
  });
  ov.querySelector('#dbg-tiles')!.addEventListener('change', (e) => {
    S.showTileIds = (e.target as HTMLInputElement).checked;
    route(); // re-render so the garden overlay appears/disappears
  });
  ov.querySelector('#dbg-json')!.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quiz-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
  ov.querySelector('#dbg-reset')!.addEventListener('click', () => {
    if (
      confirm(
        `Reset ALL garden progress? This removes every extra garden, all purchased backgrounds, your ${CURRENCY.many}, and all unlocks. This cannot be undone.`,
      )
    ) {
      resetAllGardens();
      closeDebugDialog();
      route();
    }
  });
  ov.querySelector('#dbg-close')!.addEventListener('click', closeDebugDialog);
}
