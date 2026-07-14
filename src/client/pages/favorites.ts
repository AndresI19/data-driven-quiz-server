import { setScreenBg } from '../garden/screenbg.js';
import { hidePause } from '../quiz/pause.js';
import { start } from '../quiz/session.js';
import { stopTicker } from '../quiz/timer.js';
// Favorites list page. Ported verbatim.
import { app, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { esc, setKey } from '../runtime/util.js';
import { setup } from './home.js';

export function favoritesPage(): void {
  stopTicker();
  S.running = false;
  hidePause();
  setScreenBg(false);
  const ids = Object.keys(DB.favorites).filter((id) => byId[id]);
  app.innerHTML = `<div class="wrap">
    <div class="rvbar">
      <button class="btn ghost sm" id="favback">← Home</button>
      <div class="lab" style="margin:0">★ Favorites (${ids.length})</div>
      ${ids.length ? `<button class="btn primary sm" id="favquiz">Quiz all</button>` : '<span></span>'}
    </div>
    <div class="panel">
      ${
        ids.length
          ? `<div class="favlist">${ids.map((id) => `<div class="favitem" data-id="${id}"><span class="tiny">${esc(byId[id].topic)} <span style="opacity:.55">· ${id}</span></span><button class="btn ghost sm danger" data-favdel title="remove">×</button></div>`).join('')}</div>`
          : `<div class="tiny">No favorites yet — tap the ☆ on any card to add it.</div>`
      }
    </div>
  </div>`;
  app.querySelector('#favback')!.addEventListener('click', setup);
  const fq = app.querySelector('#favquiz');
  if (fq)
    fq.addEventListener('click', () => {
      S.cfg.scope = 'fav';
      start();
    });
  app.querySelectorAll('.favitem [data-favdel]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = (b.closest('.favitem') as HTMLElement).dataset.id!;
      delete DB.favorites[id];
      saveDB();
      favoritesPage();
    }),
  );
  setKey((e) => {
    if (e.key === 'Escape') setup();
  });
}
