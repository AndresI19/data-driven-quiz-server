import { setScreenBg } from '../garden/screenbg.js';
import { addFav } from '../quiz/engine.js';
import { hidePause } from '../quiz/pause.js';
import { reviewIds } from '../quiz/session.js';
import { stopTicker } from '../quiz/timer.js';
// Notes / review page for a saved session: step through missed + noted cards, edit notes. Verbatim.
import { CATS, app, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { esc, setKey } from '../runtime/util.js';
import { setup } from './home.js';

export function reviewSession(id: string): void {
  const s = DB.sessions.find((x) => x.id === id);
  if (!s) return;
  const ids = reviewIds(s);
  if (!ids.length) return;
  stopTicker();
  S.running = false;
  hidePause();
  setScreenBg(false);
  let idx = 0;
  function render(): void {
    const cid = ids[idx];
    const c = byId[cid];
    const missed = (s!.missedIds || []).includes(cid);
    app.innerHTML = `<div class="wrap">
      <div class="rvbar">
        <button class="btn ghost sm" id="rvback">← Sessions</button>
        <div class="tiny">${esc(s!.label)} · ${esc(s!.at)}</div>
        <div class="tiny">${idx + 1} / ${ids.length}</div>
      </div>
      <div class="cardrow">
        <div class="qcard">
          <span class="dir">${missed ? 'missed' : 'noted'}</span>
          <span class="catchip">${esc(CATS[c.cat])}</span>
          <div class="topic" style="margin-bottom:10px">${esc(c.topic)}</div>
          <div class="answer">${c.back}</div>
        </div>
        <aside class="notes">
          <div class="col-h">Notes</div>
          <textarea class="noteta" id="rvnote" placeholder="Notes on this card…"></textarea>
        </aside>
      </div>
      <div class="actions center" style="margin-top:16px">
        <button class="btn ghost" id="rvprev" ${idx === 0 ? 'disabled' : ''}>← Prev</button>
        <button class="btn ghost" id="rvnext" ${idx === ids.length - 1 ? 'disabled' : ''}>Next →</button>
      </div>
    </div>`;
    const nt = app.querySelector('#rvnote') as HTMLTextAreaElement;
    nt.value = s!.notes?.[cid] || '';
    nt.addEventListener('input', () => {
      if (!s!.notes) s!.notes = {};
      const v = nt.value;
      if (v.trim()) s!.notes[cid] = v;
      else delete s!.notes[cid];
      s!.noteCount = Object.keys(s!.notes).filter((k) => (s!.notes[k] || '').trim()).length;
      saveDB();
    });
    app.querySelector('#rvback')!.addEventListener('click', setup);
    app.querySelector('#rvprev')!.addEventListener('click', () => {
      if (idx > 0) {
        idx--;
        render();
      }
    });
    app.querySelector('#rvnext')!.addEventListener('click', () => {
      if (idx < ids.length - 1) {
        idx++;
        render();
      }
    });
    addFav(c);
  }
  setKey((e) => {
    if (
      e.target &&
      (e.target as HTMLElement).classList &&
      (e.target as HTMLElement).classList.contains('noteta')
    )
      return;
    if (e.key === 'ArrowLeft') {
      if (idx > 0) {
        idx--;
        render();
      }
    } else if (e.key === 'ArrowRight') {
      if (idx < ids.length - 1) {
        idx++;
        render();
      }
    } else if (e.key === 'Escape') {
      setup();
    }
  });
  render();
}
