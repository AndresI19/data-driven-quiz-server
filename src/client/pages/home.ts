import { current, isGuest, isSignedIn } from '@platform/ui/auth';
import { audioInit, setVolume, sndFlip } from '../audio/sound.js';
import { gardenValue, switchGarden, totalGardenValue } from '../garden/economy.js';
import { enterGarden } from '../garden/page.js';
import { setScreenBg } from '../garden/screenbg.js';
import { startSplashes } from '../garden/splash.js';
import { gardenArt } from '../garden/sprites.js';
import { lifetime } from '../quiz/grading.js';
import { leavePlay } from '../quiz/pause.js';
import { discardActive, resumeActive, retrySession, reviewIds, start } from '../quiz/session.js';
import { COIN, CURRENCY } from '../runtime/currency.js';
// Home / setup screen: section + length + sound + timer + hints controls, the resume banner,
// favorites + sessions panels, the live garden mini-render, and the debug menu. Ported verbatim.
import { CARDS, CATCOL, CATS, app, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { setPath } from '../runtime/router.js';
import { S } from '../runtime/state.js';
import { esc, fmtClock, fmtSpeed, setKey, touchDist } from '../runtime/util.js';
import { exportPage } from './export.js';
import { favoritesPage } from './favorites.js';
import { reviewSession } from './review.js';

/**
 * The persistence note. It USED to say, to everyone, "saved in this browser only ... I never
 * supported a back-end." That is now false for a signed-in player — their progress syncs — and
 * telling them their gardens are about to vanish is worse than saying nothing. So it depends on who
 * is playing:
 *   guest      → the honest browser-only warning (unchanged; a guest genuinely has no back-end).
 *   signed in  → a reassurance that it follows them, and where the copy lives.
 */
function savedNote(): string {
  if (isSignedIn()) {
    const who = current()?.username ?? '';
    return `<div class="saved-note ok">☁️ Signed in as <b>${esc(who)}</b>. Your progress — quiz history, notes, gardens and ${CURRENCY.many} — is saved to your account and follows you to any browser. Sign out from the top-right to switch users.</div>`;
  }
  if (isGuest()) {
    return `<div class="saved-note">💾 You are playing as a <b>guest</b>. Your progress is saved in <b>this browser only</b> — clearing site data, private browsing, or opening the app elsewhere will start you fresh. Back it up any time with <b>Download JSON</b> in the 🪲 menu (bottom-right), or create an account from the account chip (top-right) to sync it.</div>`;
  }
  // Before a choice has been made the gate is up, so this is effectively unreachable — but if it is
  // ever shown, the guest wording is the safe default: it never overstates what is saved.
  return `<div class="saved-note">💾 Your progress is saved in <b>this browser</b> until you create an account.</div>`;
}

export function setup(): void {
  leavePlay();
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
  const noteTotal = sess.reduce(
    (n, s) => n + Object.keys(s.notes || {}).filter((k) => (s.notes[k] || '').trim()).length,
    0,
  );
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
          const retryTimer = s.timeSpeed ?? 1;
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
            ${s.missedIds.length ? `<div class="rowmini"><span class="tiny">Retry timer</span><input type="range" class="vol mini sess-speed" min="0" max="5" step="0.1" value="${retryTimer}"><span class="tiny sess-speednum">${fmtSpeed(retryTimer)}</span></div>` : ''}
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
          ${Object.keys(CATS)
            .map(
              (k) =>
                `<button class="secchip sc" data-sec="${k}" data-tip="${esc(CATS[k])}" style="--cat:${CATCOL[k]}">${k}</button>`,
            )
            .join('')}
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
      ${
        DB.gardens.length > 1
          ? `<div class="gswitch homegswitch">
        <button class="btn ghost sm" id="hgprev" ${DB.gardenIdx === 0 ? 'disabled' : ''} title="previous garden">←</button>
        <span class="gswitch-lab">Garden ${DB.gardenIdx + 1} / ${DB.gardens.length}</span>
        <button class="btn ghost sm" id="hgnext" ${DB.gardenIdx >= DB.gardens.length - 1 ? 'disabled' : ''} title="next garden">→</button>
      </div>`
          : ''
      }
      <button class="homegarden" id="homegarden" title="Open the garden editor">
        <div class="gd-head"><span class="lab gdtitle">\u{1F331} My Garden</span><span class="gdcur"><span class="gscore big" title="achievement — total across all gardens">\u{1F3C6} ${totalGardenValue()}</span><span class="gscore" title="this garden">\u{1F3C5} ${gardenValue()}</span><span class="fab-coins">${COIN} ${DB.infinite ? '∞' : DB.coins}</span></span></div>
        <div class="gdboardwrap"><div class="gboard homeboard">${gardenArt()}</div></div>
        <div class="gd-cta">Click to tend it →</div>
      </button>
      ${savedNote()}
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
  const vol = app.querySelector('#vol') as HTMLInputElement;
  const volnum = app.querySelector('#volnum') as HTMLElement;
  vol.value = String(DB.settings.volume);
  volnum.textContent = `${DB.settings.volume}%`;
  vol.addEventListener('input', () => {
    DB.settings.volume = Number.parseInt(vol.value, 10);
    volnum.textContent = `${DB.settings.volume}%`;
    setVolume();
    saveDB();
  });
  vol.addEventListener('change', () => {
    if (DB.settings.volume > 0) {
      audioInit();
      sndFlip();
    }
  });
  const tspeed = app.querySelector('#tspeed') as HTMLInputElement;
  const tspeednum = app.querySelector('#tspeednum') as HTMLElement;
  tspeed.value = String(DB.settings.timeSpeed);
  tspeednum.textContent = fmtSpeed(DB.settings.timeSpeed);
  tspeed.addEventListener('input', () => {
    DB.settings.timeSpeed = Number.parseFloat(tspeed.value);
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
      if (confirm(`Remove all ${favIds.length} favorites?`)) {
        DB.favorites = {};
        if (S.cfg.scope === 'fav') S.cfg.scope = 'all';
        saveDB();
        setup();
      }
    });
  const cn = app.querySelector('#clearnotes');
  if (cn)
    cn.addEventListener('click', () => {
      if (confirm(`Clear all ${noteTotal} notes from every session? (Sessions are kept.)`)) {
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
      if (confirm(`Delete all ${sess.length} saved sessions? This also removes their notes.`)) {
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
    const spd = el.querySelector('.sess-speed') as HTMLInputElement | null;
    const spdn = el.querySelector('.sess-speednum') as HTMLElement | null;
    if (spd)
      spd.addEventListener('input', () => {
        spdn!.textContent = fmtSpeed(Number.parseFloat(spd.value));
      });
    el.querySelectorAll('[data-sact]').forEach((b) =>
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        const act = (b as HTMLElement).dataset.sact;
        if (act === 'retry') retrySession(id, spd ? Number.parseFloat(spd.value) : undefined);
        else if (act === 'review') reviewSession(id);
        else if (act === 'del') {
          DB.sessions = DB.sessions.filter((x) => x.id !== id);
          saveDB();
          setup();
        }
      }),
    );
  });
  const len = app.querySelector('#len') as HTMLInputElement;
  const lennum = app.querySelector('#lennum') as HTMLElement;
  if (typeof S.cfg.count !== 'number') S.cfg.count = 20;
  const setLen = (): void => {
    const v = Number.parseInt(len.value, 10);
    lennum.textContent = v >= CARDS.length ? `All (${CARDS.length})` : `${v} cards`;
  };
  len.value = String(Math.min(S.cfg.count, CARDS.length));
  setLen();
  len.addEventListener('input', () => {
    S.cfg.count = Number.parseInt(len.value, 10);
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
  if (hg) {
    // A tap enters the garden; a horizontal drag pans the preview instead (the garden overflows the
    // width on a phone). The click is suppressed once a drag passes the threshold, so a pan never also
    // opens the editor. Bounds keep an edge from pulling inside the frame.
    const frame = hg.querySelector<HTMLElement>('.gdboardwrap');
    const board = hg.querySelector<HTMLElement>('.homeboard');
    if (frame && board) {
      let panX = 0;
      let panY = 0;
      let moved = false;
      // The board's effective scale, driven exactly like the editor's --gfit: clamped to [fit, 1],
      // where fit is the scale at which the whole 800×448 board sits inside the frame. So a pinch zooms
      // OUT to the fit (the entire garden) and IN to full detail. The old model floored the scale at
      // 0.82 and only let it grow, which is why the preview could zoom in but never out.
      let scale = 0.82;
      let fit = 0.82;

      // fit from the board's UNSCALED layout size (offsetWidth ignores the transform) against the frame,
      // capped at 1 so the preview never enlarges past full detail.
      const measure = (): { fw: number; fh: number; bw: number; bh: number } => {
        const fw = frame.clientWidth;
        const fh = frame.clientHeight;
        const bw = board.offsetWidth;
        const bh = board.offsetHeight;
        fit = Math.min(1, fw / bw, fh / bh);
        return { fw, fh, bw, bh };
      };

      // Clamp the scale into range, then place the board: bigger than the frame → pan within bounds,
      // smaller → centre. Writes the three CSS vars the transform reads.
      const apply = (): void => {
        const { fw, fh, bw, bh } = measure();
        scale = Math.max(fit, Math.min(1, scale));
        const sw = bw * scale;
        const sh = bh * scale;
        panX = sw > fw ? Math.min(0, Math.max(fw - sw, panX)) : (fw - sw) / 2;
        panY = sh > fh ? Math.min(0, Math.max(fh - sh, panY)) : (fh - sh) / 2;
        board.style.setProperty('--pv-scale', String(scale));
        board.style.setProperty('--pan-x', `${panX}px`);
        board.style.setProperty('--pan-y', `${panY}px`);
      };
      requestAnimationFrame(() => {
        measure();
        scale = Math.min(1, Math.max(fit, 0.82)); // a framed default, never below the fit
        apply();
      });

      // Two-finger pinch zooms about the finger midpoint — the same focal maths as the editor board,
      // expressed on the transform rather than a scroller's scrollLeft.
      let pinchGap = 0;
      let pinchScale = 1;
      frame.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length === 2) {
            pinchGap = touchDist(e.touches);
            pinchScale = scale;
            moved = true; // a pinch is not a tap — keep it from entering the garden
          }
        },
        { passive: true },
      );
      frame.addEventListener(
        'touchmove',
        (e) => {
          if (e.touches.length !== 2 || pinchGap === 0) return;
          e.preventDefault();
          const r = frame.getBoundingClientRect();
          const fx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
          const fy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
          const s0 = scale;
          scale = Math.max(fit, Math.min(1, pinchScale * (touchDist(e.touches) / pinchGap)));
          const k = scale / s0; // keep the content under the midpoint fixed as it scales
          panX = fx - (fx - panX) * k;
          panY = fy - (fy - panY) * k;
          apply();
        },
        { passive: false },
      );
      const endPinch = (e: TouchEvent): void => {
        if (e.touches.length < 2) pinchGap = 0;
      };
      frame.addEventListener('touchend', endPinch);
      frame.addEventListener('touchcancel', endPinch);

      // Single-finger / mouse drag pans horizontally (vertical is the page's). Skipped while a pinch
      // owns the gesture; a real drag suppresses the enter-garden click.
      let dragging = false;
      let downX = 0;
      let baseX = 0;
      frame.addEventListener('pointerdown', (e) => {
        if (pinchGap > 0) return;
        dragging = true;
        moved = false;
        downX = e.clientX;
        baseX = panX;
        frame.setPointerCapture(e.pointerId);
        frame.classList.add('grabbing');
      });
      frame.addEventListener('pointermove', (e) => {
        if (!dragging || pinchGap > 0) return;
        const dx = e.clientX - downX;
        if (Math.abs(dx) > 4) moved = true;
        panX = baseX + dx;
        apply();
      });
      const endDrag = (e: PointerEvent): void => {
        dragging = false;
        frame.classList.remove('grabbing');
        try {
          frame.releasePointerCapture(e.pointerId);
        } catch {
          // capture already gone; nothing to release.
        }
      };
      frame.addEventListener('pointerup', endDrag);
      frame.addEventListener('pointercancel', endDrag);

      // Swallow the click a drag or pinch would otherwise deliver to the button.
      hg.addEventListener('click', (e) => {
        if (moved) {
          e.preventDefault();
          e.stopImmediatePropagation();
          moved = false;
        }
      });
    }
    hg.addEventListener('click', enterGarden);
  }
  const hgp = app.querySelector('#hgprev');
  if (hgp)
    hgp.addEventListener('click', () => {
      switchGarden(DB.gardenIdx - 1);
      setup();
    });
  const hgn = app.querySelector('#hgnext');
  if (hgn)
    hgn.addEventListener('click', () => {
      switchGarden(DB.gardenIdx + 1);
      setup();
    });
  startSplashes();
}
