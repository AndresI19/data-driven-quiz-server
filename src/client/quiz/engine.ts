import type { GameCard } from '../../shared/card-schema.js';
import { audioInit, sndFlip } from '../audio/sound.js';
import { comboMult } from '../garden/economy.js';
import { setScreenBg } from '../garden/screenbg.js';
import { setup } from '../pages/home.js';
import { COIN } from '../runtime/currency.js';
// Quiz engine: the HUD, the per-card dispatcher (renderQ), fav/flag + notes decoration, arrow-key
// navigation with peek-back, and the results screen. Ported verbatim.
import { CATCOL, CATS, app, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { setPath } from '../runtime/router.js';
import { S } from '../runtime/state.js';
import { esc, fmtClock, setKey, shuffle } from '../runtime/util.js';
import { resolveMode } from './capabilities.js';
import {
  renderBF,
  renderCS,
  renderCW,
  renderCZ,
  renderDM,
  renderFB,
  renderIV,
  renderMA,
  renderMS,
} from './modes.js';
import { closeZoom, dismissTransients } from './pause.js';
import { advance, begin, finalize, persist } from './session.js';
import { baseSeconds, startTicker, stopTicker } from './timer.js';

export function hud(): string {
  const ses = S.ses!;
  const prog = Math.round((ses.i / ses.q.length) * 100);
  return `<div class="hud">
    <div class="bar"><i style="width:${prog}%"></i></div>
    <span>${ses.i + 1} / ${ses.q.length}</span>
    <span class="pill" id="ctime" title="time on this card"></span>
    <span class="pill good">✓ ${ses.correct}</span>
    <span class="pill bad">✗ ${ses.i - ses.correct}</span>
    <span class="pill" id="stime" title="total session time"></span>
    <button class="pillbtn" id="pausebtn" title="pause (P)">⏸</button>
  </div>`;
}
export function renderQ(): void {
  const ses = S.ses!;
  setPath('/quiz');
  setScreenBg(false);
  if (ses.i >= ses.q.length) {
    finalize();
    return results();
  }
  const it = ses.q[ses.i];
  const c = byId[it.id];
  if (!c) {
    advance();
    return;
  }
  audioInit();
  sndFlip();
  const mode = resolveMode(it.d, c);
  S.curLimit = ses.timeSpeed > 0 ? baseSeconds(c, mode) / ses.timeSpeed : 0;
  startTicker();
  S.running = true;
  if (mode === 'fb') renderFB(c);
  else if (mode === 'bf') renderBF(c);
  else if (mode === 'cz') renderCZ(c);
  else if (mode === 'ma') renderMA(c);
  else if (mode === 'iv') renderIV(c);
  else if (mode === 'dm') renderDM(c);
  else if (mode === 'cw') renderCW(c);
  else if (mode === 'cs') renderCS(c);
  else renderMS(c);
  decorateCard(c);
}
export function addFav(c: GameCard): void {
  const qc = app.querySelector('.qcard') as HTMLElement | null;
  if (!qc) return;
  qc.style.setProperty('--cat', CATCOL[c.cat] || '#5a67f2');
  const fav = document.createElement('button');
  const set = (): void => {
    const on = !!DB.favorites[c.id];
    fav.className = `favbtn${on ? ' on' : ''}`;
    fav.innerHTML = on ? '★' : '☆';
    fav.title = on ? 'unfavorite' : 'favorite';
  };
  set();
  fav.addEventListener('click', () => {
    if (DB.favorites[c.id]) delete DB.favorites[c.id];
    else DB.favorites[c.id] = true;
    saveDB();
    set();
  });
  qc.appendChild(fav);
  const flag = document.createElement('button');
  const setF = (): void => {
    const on = !!DB.flags[c.id];
    flag.className = `flagbtn${on ? ' on' : ''}`;
    flag.innerHTML = on ? '⚑' : '⚐';
    flag.title = on ? 'flagged for review — click to clear' : 'flag this card for review';
  };
  setF();
  flag.addEventListener('click', () => {
    if (DB.flags[c.id]) delete DB.flags[c.id];
    else DB.flags[c.id] = true;
    saveDB();
    setF();
  });
  qc.appendChild(flag);
}
export function decorateCard(c: GameCard): void {
  const ses = S.ses!;
  const qc = app.querySelector('.qcard') as HTMLElement | null;
  if (!qc) return;
  addFav(c);
  if (S.curLimit > 0) {
    const b = document.createElement('div');
    b.className = 'tbar';
    b.innerHTML = '<div class="tbar-track"><i></i></div><span class="tbar-t"></span>';
    qc.appendChild(b);
  }
  // wrap card + a right-hand notes panel into a two-column row
  const row = document.createElement('div');
  row.className = 'cardrow';
  qc.parentNode!.insertBefore(row, qc);
  row.appendChild(qc);
  const aside = document.createElement('aside');
  aside.className = 'notes';
  aside.innerHTML = `<div class="coinbar" id="coinbar"><span class="cb-ico">${COIN}</span> <span class="cb-coins">${DB.infinite ? '∞' : DB.coins}</span><span class="cb-combo${DB.combo >= 2 ? ' hot' : ''}">\u{1F525} ${DB.combo} ×${comboMult().toFixed(1)}</span></div><div class="col-h">Notes</div><textarea class="noteta" placeholder="Notes on this card…"></textarea>`;
  row.appendChild(aside);
  const nta = aside.querySelector('.noteta') as HTMLTextAreaElement;
  nta.value = ses.notes?.[c.id] || '';
  nta.addEventListener('input', () => {
    const v = nta.value;
    if (v.trim()) ses.notes[c.id] = v;
    else delete ses.notes[c.id];
    persist();
  });
}
// ---- card navigation: arrow keys advance/peek-back ----
export function navKey(e: KeyboardEvent, answered: boolean): boolean {
  if (document.getElementById('peekov')) {
    if (e.key === 'ArrowRight' || e.key === 'Escape') {
      e.preventDefault();
      closePeek();
    }
    return true;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    peekBack();
    return true;
  }
  if (answered && e.key === 'ArrowRight') {
    e.preventDefault();
    advance();
    return true;
  }
  return false;
}
export function peekBack(): void {
  const ses = S.ses;
  if (!ses || ses.i <= 0) return;
  const c = byId[ses.q[ses.i - 1].id];
  if (!c) return;
  closePeek();
  closeZoom();
  const ov = document.createElement('div');
  ov.id = 'peekov';
  ov.className = 'pauseov';
  const note = ses.notes?.[c.id]
    ? `<div class="col mine" style="margin-top:12px"><div class="col-h">Your note</div><div class="mine-body">${esc(ses.notes[c.id])}</div></div>`
    : '';
  ov.innerHTML = `<div class="pausebox" style="max-width:660px;text-align:left;max-height:88vh;overflow:auto">
    <div class="lab" style="margin-bottom:8px">← Previous card</div>
    <span class="catchip" style="--cat:${CATCOL[c.cat] || '#5a67f2'}">${esc(CATS[c.cat])}</span>
    <div class="topic" style="margin:6px 0 6px;font-size:19px">${esc(c.topic)}</div>
    <div class="answer">${c.back}</div>${note}
    <div class="actions center" style="margin-top:16px"><button class="btn primary" id="peekclose">Back to quiz →</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => {
    if (e.target === ov) closePeek();
  });
  ov.querySelector('#peekclose')!.addEventListener('click', closePeek);
}
export function closePeek(): void {
  const o = document.getElementById('peekov');
  if (o) o.remove();
}
export function results(): void {
  const ses = S.ses!;
  stopTicker();
  S.running = false;
  dismissTransients();
  setKey((e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      setup();
    }
  });
  const total = ses.q.length;
  const correct = ses.correct;
  const pct = total ? Math.round((correct / total) * 100) : 0;
  const missed = ses.missed.map((id) => byId[id]).filter(Boolean);
  const allCards = ses.q.map((it) => byId[it.id]).filter(Boolean);
  const label = ses.label;
  const retryMissed = ses.retryMissed || [];
  const speed = ses.timeSpeed;
  const revs = missed
    .map(
      (c) =>
        `<details class="rev"><summary><span>${esc(c.topic)} <span class="tiny">· ${c.id}</span></span><span class="miss-tag">missed</span></summary><div class="body"><div class="answer">${c.back}</div></div></details>`,
    )
    .join('');
  app.innerHTML = `<div class="wrap"><div class="panel">
    <div class="score">${pct}<small>%</small></div>
    <div class="scoreline">${correct} of ${total} correct · ⏱ ${fmtClock(ses.elapsedMs)}${ses.coins ? ` · ${COIN} ${ses.coins} earned` : ''}${ses.setBonus ? ` <span class="tiny">(+${ses.setBonus} set bonus)</span>` : ''} · saved to sessions</div>
    <div class="actions center">
      ${missed.length ? `<button class="btn primary" id="retry">Retry missed (${missed.length})</button>` : ''}
      <button class="btn ghost" id="redo">Redo all (${allCards.length})</button>
      <button class="btn ghost" id="home">Home</button>
    </div>
    ${missed.length ? `<div class="review"><div class="lab" style="margin:24px 0 10px">Missed this session</div>${revs}</div>` : ''}
  </div></div>`;
  app.querySelector('#home')!.addEventListener('click', setup);
  app
    .querySelector('#redo')!
    .addEventListener('click', () => begin(shuffle(allCards.slice()), { label, timeSpeed: speed }));
  const r = app.querySelector('#retry');
  if (r)
    r.addEventListener('click', () =>
      begin(shuffle(retryMissed.map((id) => byId[id]).filter(Boolean)), {
        label: `Retry · ${label}`,
        timeSpeed: speed,
      }),
    );
}
