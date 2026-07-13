// Home / setup screen: section + length + sound + timer + hints controls, the resume banner,
// favorites + sessions panels, the live garden mini-render, and the debug menu. Ported verbatim.
import { app, CATS, CATCOL, CARDS, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { esc, fmtClock, fmtSpeed, setKey } from '../runtime/util.js';
import { setVolume, audioInit, sndFlip } from '../audio/sound.js';
import { lifetime } from '../quiz/grading.js';
import { start, resumeActive, discardActive, retrySession, reviewIds } from '../quiz/session.js';
import { reviewSession } from './review.js';
import { favoritesPage } from './favorites.js';
import { exportPage } from './export.js';
import { setPath } from '../runtime/router.js';
import { gardenValue, totalGardenValue, switchGarden } from '../garden/economy.js';
import { gardenArt } from '../garden/sprites.js';
import { gardenPage } from '../garden/page.js';
import { startSplashes } from '../garden/splash.js';
import { setScreenBg } from '../garden/screenbg.js';
import { stopTicker } from '../quiz/timer.js';
import { hidePause } from '../quiz/pause.js';

export function setup(): void {
  stopTicker();
  S.running = false;
  hidePause();
  setPath('/home');
  setScreenBg(true);
  setKey((e) => {
    if (e.key === 'Enter') start();
  });
  const a = DB.active;
  const resumeHtml = a
    ? `
    <div class="panel resume" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><div class="lab" style="margin-bottom:4px">Resume in progress</div>
          <div style="font-weight:650">${esc(a.label)} <span class="tiny">· ${a.i}/${a.q.length}</span></div></div>
        <div class="actions" style="margin:0"><button class="btn primary" id="resume">Resume</button><button class="btn ghost" id="discard">Discard</button></div>
      </div>
    </div>`
    : '';
  const favIds = Object.keys(DB.favorites).filter((id) => byId[id]);
  const favHtml = favIds.length
    ? `
    <div class="panel" style="margin-top:16px">
      <div class="lab" style="margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">★ Favorites (${favIds.length})
        <button class="btn ghost sm" id="quizfav">Quiz these</button>
        <button class="btn ghost sm" id="viewfav">View all</button>
        <button class="btn ghost sm danger" id="clearfav" style="margin-left:auto">Delete all</button>
      </div>
    </div>`
    : '';
  const sess = DB.sessions || [];
  const noteTotal = sess.reduce((n, s) => n + Object.keys(s.notes || {}).filter((k) => (s.notes[k] || '').trim()).length, 0);
  const sessHtml = sess.length
    ? `
    <div class="panel" style="margin-top:16px">
      <div class="lab" style="margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">Sessions (${sess.length})
        ${noteTotal ? `<button class="btn ghost sm" id="clearnotes">Clear notes (${noteTotal})</button>` : ''}
        <button class="btn ghost sm danger" id="clearsess" style="margin-left:auto">Delete all</button>
      </div>
      ${sess
        .map((s, i) => {
          const rc = reviewIds(s).length;
          return `
        <details class="sess" data-id="${s.id}">
          <summary>
            <div class="sess-top"><span class="deck-name">${esc(s.label)}</span>${i === 0 ? ` <span class="latest">latest</span>` : ''} <span class="tiny">${esc(s.at)}</span></div>
            <div class="sess-metrics">
              <span class="m good">${s.correct}/${s.total}</span>
              <span class="m">${s.total ? Math.round((s.correct / s.total) * 100) : 0}%</span>
              <span class="m bad">✗ ${s.wrong}</span>
              <span class="m">📝 ${s.noteCount}</span>
              <span class="m">⏱ ${fmtClock(s.elapsedMs)}</span>
            </div>
          </summary>
          <div class="sess-body">
            ${s.missedIds.length ? `<div class="rowmini"><span class="tiny">Retry timer</span><input type="range" class="vol mini sess-speed" min="0" max="5" step="0.1" value="${s.timeSpeed == null ? 1 : s.timeSpeed}"><span class="tiny sess-speednum">${fmtSpeed(s.timeSpeed == null ? 1 : s.timeSpeed)}</span></div>` : ''}
            <div class="actions" style="margin:10px 0 0;flex-wrap:wrap">
              ${rc ? `<button class="btn ghost sm" data-sact="review">Notes / review (${rc})</button>` : `<span class="tiny">Nothing to review</span>`}
              ${s.missedIds.length ? `<button class="btn ghost sm" data-sact="retry">Retry missed (${s.missedIds.length})</button>` : ''}
              <button class="btn ghost sm danger" data-sact="del">Delete</button>
            </div>
          </div>
        </details>`;
        })
        .join('')}
    </div>`
    : '';
  app.innerHTML = `
  <a class="homelink" href="/" title="Back to the platform home page">← Home</a>
  <div class="wrap homewrap">
    <div class="masthead">
      <h1>Cloud Developer Quiz</h1>
      <div class="mast-by">by Andres Irarragorri</div>
    </div>
    <div class="homecols">
    <div class="homecol homeleft">
    ${resumeHtml}
    <div class="panel">
      <div class="panelsub">${CARDS.length} cards · recall, multiple-choice & fill-in-the-blank. <span class="tiny">${lifetime()}</span>${Object.keys(DB.stats).length ? ` <button class="linkbtn" id="resetstats">reset</button>` : ''} <button class="linkbtn" id="exportbtn">export</button></div>
      <div class="row"><div class="lab">Sections</div>
        <div class="secchips" id="secchips">
          <button class="secchip all" data-sec="all">All (${CARDS.length})</button>
          ${Object.keys(DB.favorites).length ? `<button class="secchip fav" data-sec="fav">★ Favorites</button>` : ''}
          ${Object.keys(CATS).map((k) => `<button class="secchip sc" data-sec="${k}" data-tip="${esc(CATS[k])}" style="--cat:${CATCOL[k]}">${k}</button>`).join('')}
        </div></div>
      <div class="row"><div class="lab">Length</div>
        <div class="sndrow">
          <input type="range" id="len" class="vol" min="5" max="${CARDS.length}">
          <span class="tiny" id="lennum"></span>
        </div></div>
      <div class="row"><div class="lab">Sound</div>
        <div class="sndrow">
          <input type="range" id="vol" class="vol" min="0" max="100">
          <span class="tiny" id="volnum"></span>
          <span class="tiny" style="opacity:.7">· 0% = muted</span>
        </div></div>
      <div class="row"><div class="lab">Timer speed</div>
        <div class="sndrow">
          <input type="range" id="tspeed" class="vol" min="0" max="5" step="0.1">
          <span class="tiny" id="tspeednum"></span>
          <span class="tiny" style="opacity:.7">· scales with card length · 0 = off</span>
        </div></div>
      <div class="row"><div class="lab">Recall hints</div>
        <div class="sndrow"><label class="snd-toggle"><input type="checkbox" id="hints"> Show a starting-point hint on recall cards</label></div></div>
      <div class="startbar">
        <span class="tiny"><kbd>Ctrl+Enter</kbd>/<kbd>Space</kbd> submit · <kbd>1</kbd>–<kbd>8</kbd> grade</span>
        <button class="btn primary" id="start">Start quiz →</button>
      </div>
    </div>
    ${favHtml}
    ${sessHtml}
    <div class="panel" style="margin-top:16px">
      <div class="lab" style="margin:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">🖨 Printable cards
        <span class="tiny" style="font-weight:400;text-transform:none;letter-spacing:0">${CARDS.length}-card front/back sheet · 8 per page</span>
        <a class="btn primary sm" id="printcards" href="${import.meta.env.BASE_URL}print.html" style="margin-left:auto;text-decoration:none">Open print sheet →</a>
      </div>
    </div>
    </div>
    <div class="homecol homeright">
      ${DB.gardens.length > 1 ? `<div class="gswitch homegswitch">
        <button class="btn ghost sm" id="hgprev" ${DB.gardenIdx === 0 ? 'disabled' : ''} title="previous garden">←</button>
        <span class="gswitch-lab">Garden ${DB.gardenIdx + 1} / ${DB.gardens.length}</span>
        <button class="btn ghost sm" id="hgnext" ${DB.gardenIdx >= DB.gardens.length - 1 ? 'disabled' : ''} title="next garden">→</button>
      </div>` : ''}
      <button class="homegarden" id="homegarden" title="Open the garden editor">
        <div class="gd-head"><span class="lab gdtitle">\u{1F331} My Garden</span><span class="gdcur"><span class="gscore big" title="achievement — total across all gardens">\u{1F3C6} ${totalGardenValue()}</span><span class="gscore" title="this garden">\u{1F3C5} ${gardenValue()}</span><span class="fab-coins">\u{1FA99} ${DB.infinite ? '∞' : DB.coins}</span></span></div>
        <div class="gdboardwrap"><div class="gboard homeboard">${gardenArt()}</div></div>
        <div class="gd-cta">Click to tend it →</div>
      </button>
      <div class="saved-note">💾 Your progress — quiz history, notes, gardens and coins — is saved in <b>this browser only</b>. Clearing site data, private browsing, or opening the app on another device or browser will start you fresh. Back it up any time with <b>Download JSON</b> in the 🪲 menu (bottom-right). <i>(I never supported a back-end.)</i></div>
    </div>
    </div>
  </div>`;
  S.cfg.direction = 'mixed';
  const refreshSecs = (): void =>
    app.querySelectorAll('.secchip').forEach((b) => {
      const s = (b as HTMLElement).dataset.sec!;
      const on =
        S.cfg.scope === 'all'
          ? s === 'all'
          : S.cfg.scope === 'fav'
            ? s === 'fav'
            : Array.isArray(S.cfg.scope) && S.cfg.scope.includes(s);
      b.classList.toggle('on', on);
    });
  refreshSecs();
  app.querySelectorAll('.secchip').forEach((b) =>
    b.addEventListener('click', () => {
      const s = (b as HTMLElement).dataset.sec!;
      if (s === 'all') S.cfg.scope = 'all';
      else if (s === 'fav') S.cfg.scope = 'fav';
      else {
        if (!Array.isArray(S.cfg.scope)) S.cfg.scope = [];
        const i = S.cfg.scope.indexOf(s);
        if (i >= 0) S.cfg.scope.splice(i, 1);
        else S.cfg.scope.push(s);
        if (!S.cfg.scope.length) S.cfg.scope = 'all';
      }
      refreshSecs();
    }),
  );
  app.querySelector('#start')!.addEventListener('click', () => start());
  const vol = app.querySelector('#vol') as HTMLInputElement,
    volnum = app.querySelector('#volnum') as HTMLElement;
  vol.value = String(DB.settings.volume);
  volnum.textContent = DB.settings.volume + '%';
  vol.addEventListener('input', () => {
    DB.settings.volume = parseInt(vol.value, 10);
    volnum.textContent = DB.settings.volume + '%';
    setVolume();
    saveDB();
  });
  vol.addEventListener('change', () => {
    if (DB.settings.volume > 0) {
      audioInit();
      sndFlip();
    }
  });
  const tspeed = app.querySelector('#tspeed') as HTMLInputElement,
    tspeednum = app.querySelector('#tspeednum') as HTMLElement;
  tspeed.value = String(DB.settings.timeSpeed);
  tspeednum.textContent = fmtSpeed(DB.settings.timeSpeed);
  tspeed.addEventListener('input', () => {
    DB.settings.timeSpeed = parseFloat(tspeed.value);
    tspeednum.textContent = fmtSpeed(DB.settings.timeSpeed);
    saveDB();
  });
  const hints = app.querySelector('#hints') as HTMLInputElement;
  hints.checked = DB.settings.hints;
  hints.addEventListener('change', () => {
    DB.settings.hints = hints.checked;
    saveDB();
  });
  const qf = app.querySelector('#quizfav');
  if (qf)
    qf.addEventListener('click', () => {
      S.cfg.scope = 'fav';
      start();
    });
  const vf = app.querySelector('#viewfav');
  if (vf) vf.addEventListener('click', favoritesPage);
  const cf = app.querySelector('#clearfav');
  if (cf)
    cf.addEventListener('click', () => {
      if (confirm('Remove all ' + favIds.length + ' favorites?')) {
        DB.favorites = {};
        if (S.cfg.scope === 'fav') S.cfg.scope = 'all';
        saveDB();
        setup();
      }
    });
  const cn = app.querySelector('#clearnotes');
  if (cn)
    cn.addEventListener('click', () => {
      if (confirm('Clear all ' + noteTotal + ' notes from every session? (Sessions are kept.)')) {
        DB.sessions.forEach((s) => {
          s.notes = {};
          s.noteCount = 0;
        });
        if (DB.active) DB.active.notes = {};
        saveDB();
        setup();
      }
    });
  const cs = app.querySelector('#clearsess');
  if (cs)
    cs.addEventListener('click', () => {
      if (confirm('Delete all ' + sess.length + ' saved sessions? This also removes their notes.')) {
        DB.sessions = [];
        saveDB();
        setup();
      }
    });
  if (a) {
    app.querySelector('#resume')!.addEventListener('click', resumeActive);
    app.querySelector('#discard')!.addEventListener('click', discardActive);
  }
  app.querySelectorAll('.sess').forEach((el) => {
    const id = (el as HTMLElement).dataset.id!;
    const spd = el.querySelector('.sess-speed') as HTMLInputElement | null,
      spdn = el.querySelector('.sess-speednum') as HTMLElement | null;
    if (spd) spd.addEventListener('input', () => {
      spdn!.textContent = fmtSpeed(parseFloat(spd.value));
    });
    el.querySelectorAll('[data-sact]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        const act = (b as HTMLElement).dataset.sact;
        if (act === 'retry') retrySession(id, spd ? parseFloat(spd.value) : undefined);
        else if (act === 'review') reviewSession(id);
        else if (act === 'del') {
          DB.sessions = DB.sessions.filter((x) => x.id !== id);
          saveDB();
          setup();
        }
      }),
    );
  });
  const len = app.querySelector('#len') as HTMLInputElement,
    lennum = app.querySelector('#lennum') as HTMLElement;
  if (typeof S.cfg.count !== 'number') S.cfg.count = 20;
  const setLen = (): void => {
    const v = parseInt(len.value, 10);
    lennum.textContent = v >= CARDS.length ? 'All (' + CARDS.length + ')' : v + ' cards';
  };
  len.value = String(Math.min(S.cfg.count, CARDS.length));
  setLen();
  len.addEventListener('input', () => {
    S.cfg.count = parseInt(len.value, 10);
    setLen();
  });
  const rs = app.querySelector('#resetstats');
  if (rs)
    rs.addEventListener('click', () => {
      if (confirm('Reset lifetime accuracy stats?')) {
        DB.stats = {};
        saveDB();
        setup();
      }
    });
  const eb = app.querySelector('#exportbtn');
  if (eb) eb.addEventListener('click', exportPage);
  const hg = app.querySelector('#homegarden');
  if (hg) hg.addEventListener('click', gardenPage);
  const hgp = app.querySelector('#hgprev');
  if (hgp) hgp.addEventListener('click', () => { switchGarden(DB.gardenIdx - 1); setup(); });
  const hgn = app.querySelector('#hgnext');
  if (hgn) hgn.addEventListener('click', () => { switchGarden(DB.gardenIdx + 1); setup(); });
  startSplashes();
}
