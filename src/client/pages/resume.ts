// Résumé page: renders the PDF (served at /resume.pdf) full-page in an iframe, with a slim
// toolbar to return home or open the file in a new tab.
import { app } from '../runtime/data.js';
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import { stopTicker } from '../quiz/timer.js';
import { hidePause } from '../quiz/pause.js';
import { stopSplashes } from '../garden/splash.js';
import { setPath } from '../runtime/router.js';
import { setScreenBg } from '../garden/screenbg.js';
import { setup } from './home.js';

export function resumePage(): void {
  stopTicker();
  S.running = false;
  hidePause();
  stopSplashes();
  setPath('/resume');
  setScreenBg(false);
  app.innerHTML = `
    <div class="resroot">
      <div class="resbar">
        <button class="btn ghost sm" id="resback">← Home</button>
        <span class="lab" style="margin:0">Résumé · Andres Irarragorri</span>
        <a class="btn ghost sm" id="resopen" href="${import.meta.env.BASE_URL}resume.pdf" target="_blank" rel="noopener">Open in new tab ↗</a>
      </div>
      <iframe id="resframe" src="${import.meta.env.BASE_URL}resume.pdf#zoom=100" title="Résumé — Andres Irarragorri"></iframe>
    </div>`;
  app.querySelector('#resback')!.addEventListener('click', setup);
  setKey((e) => {
    if (e.key === 'Escape') setup();
  });
}
