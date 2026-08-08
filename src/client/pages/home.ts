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
import { CARDS, CATEGORIES, LABELS, app, byId } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { setPath } from '../runtime/router.js';
import { S } from '../runtime/state.js';
import { esc, fmtClock, fmtSpeed, setKey, touchDist } from '../runtime/util.js';
import { exportPage } from './export.js';
import { favoritesPage } from './favorites.js';
import { reviewSession } from './review.js';
import { studyPage } from './study.js';

/** How many cards carry a label. Shown on the chip as a sizing hint, not a budget — labels overlap,
 *  so these do not sum to the category total. */
const labelCount = (k: string): number => CARDS.reduce((n, c) => (c.labels.includes(k) ? n + 1 : n), 0);

/** One label chip: its display name and card count, tinted from the label registry. */
const labelChip = (k: string): string =>
  `<button class="secchip lc" data-label="${k}" style="--cat:${LABELS[k]?.color ?? '#888'}">${esc(LABELS[k]?.name ?? k)} <span class="lcnum">${labelCount(k)}</span></button>`;

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
      <div class="panelsub">${CARDS.length} cards · multiple-choice, fill-in, match & drag-to-order. <span class="tiny">${lifetime()}</span>${Object.keys(DB.stats).length ? ` <button class="linkbtn" id="resetstats">reset</button>` : ''} <button class="linkbtn" id="exportbtn">export</button></div>
      <div class="row"><div class="lab">Categories <span class="poolnum" id="poolcount"></span></div>
        <div class="secchips" id="secchips">
          <div class="catrow catrow-top">
            <button class="secchip all" data-label="all">All (${CARDS.length})</button>
            ${Object.keys(DB.favorites).length ? `<button class="secchip fav" data-label="fav">★ Favorites</button>` : ''}
          </div>
          ${CATEGORIES.map((g) => {
            // Union, not sum: a card can carry two of a category's labels, so adding the per-label
            // counts would overstate the pool.
            const n = CARDS.filter((c) => g.labels.some((l) => c.labels.includes(l))).length;
            return `<div class="catblock" style="--cat:${g.color}">
              <button class="cathead" data-cat="${g.key}" data-labels="${g.labels.join(',')}">
                <span class="catname">${esc(g.name)}</span><span class="catnum">${n}</span>
              </button>
              <div class="catlabels">${g.labels.map(labelChip).join('')}</div>
            </div>`;
          }).join('')}
        </div></div>
      <div class="row"><div class="lab">Length</div>
        <div class="sndrow">
          <input type="range" id="len" class="vol" min="5" max="${CARDS.length}">
          <span class="tiny" id="lennum"></span>
        </div></div>
      <div class="row"><div class="lab">Timer speed</div>
        <div class="sndrow">
          <input type="range" id="tspeed" class="vol" min="0" max="5" step="0.1">
          <span class="tiny" id="tspeednum"></span>
          <span class="tiny" style="opacity:.7">· scales with card length · 0 = off</span>
        </div></div>
      <div class="row"><div class="lab">Sound</div>
        <div class="sndrow">
          <button class="switch" id="sndsw" role="switch" aria-checked="false"><span class="knob"></span></button>
          <span class="tiny" id="volnum"></span>
        </div></div>
      <div class="startbar">
        <span class="tiny"><kbd>Enter</kbd> start · <kbd>1</kbd>–<kbd>8</kbd> pick · <kbd>Enter</kbd> check</span>
        <button class="btn primary" id="start">Start quiz →</button>
      </div>
      <button class="btn ghost studybtn" id="studybtn">📖 Study mode — read every card in full →</button>
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
  // A scope array used to hold SECTION keys and now holds LABEL keys. A session saved before that
  // change would carry letters that match nothing, so drop anything unrecognised rather than
  // silently starting a quiz with an empty pool.
  if (Array.isArray(S.cfg.scope)) {
    const valid = S.cfg.scope.filter((k) => LABELS[k]);
    S.cfg.scope = valid.length ? valid : 'all';
  }

  const refreshSecs = (): void => {
    const sel = (k: string): boolean => Array.isArray(S.cfg.scope) && S.cfg.scope.includes(k);
    app.querySelectorAll('.cathead').forEach((b) => {
      const el = b as HTMLElement;
      // A category header lights only when EVERY label it owns is selected.
      b.classList.toggle('on', el.dataset.labels!.split(',').every(sel));
    });
    app.querySelectorAll('.secchip').forEach((b) => {
      const el = b as HTMLElement;
      const k = el.dataset.label!;
      const on = S.cfg.scope === 'all' ? k === 'all' : S.cfg.scope === 'fav' ? k === 'fav' : sel(k);
      b.classList.toggle('on', on);
    });
  };
  refreshSecs();

  const applyScope = (keys: string[], wholeSet: boolean): void => {
    const cur = Array.isArray(S.cfg.scope) ? [...S.cfg.scope] : [];
    const allOn = keys.every((k) => cur.includes(k));
    const next =
      wholeSet && allOn
        ? cur.filter((k) => !keys.includes(k))
        : allOn
          ? cur.filter((k) => !keys.includes(k))
          : [...new Set([...cur, ...keys])];
    S.cfg.scope = next.length ? next : 'all';
    refreshSecs();
    syncLen(); // the selection changed — retune the length slider's ceiling to it
  };

  app
    .querySelectorAll('.cathead')
    .forEach((b) =>
      b.addEventListener('click', () => applyScope((b as HTMLElement).dataset.labels!.split(','), true)),
    );
  app.querySelectorAll('.secchip').forEach((b) =>
    b.addEventListener('click', () => {
      const k = (b as HTMLElement).dataset.label!;
      if (k === 'all' || k === 'fav') {
        S.cfg.scope = k;
        refreshSecs();
        syncLen();
        return;
      }
      applyScope([k], false);
    }),
  );
  app.querySelector('#start')!.addEventListener('click', () => start());
  // Sound is a switch, not a level. `volume` stays a 0–100 number because setVolume() and the saved
  // settings both read it — the switch just moves it between 0 and a remembered level, so a player
  // who had picked 35% gets 35% back rather than a hard-coded default.
  const sndsw = app.querySelector('#sndsw') as HTMLButtonElement;
  const volnum = app.querySelector('#volnum') as HTMLElement;
  let lastLevel = DB.settings.volume > 0 ? DB.settings.volume : 60;
  const paintSound = (): void => {
    const on = DB.settings.volume > 0;
    sndsw.setAttribute('aria-checked', String(on));
    sndsw.classList.toggle('on', on);
    volnum.textContent = on ? 'On' : 'Off';
  };
  paintSound();
  sndsw.addEventListener('click', () => {
    if (DB.settings.volume > 0) {
      lastLevel = DB.settings.volume;
      DB.settings.volume = 0;
    } else {
      DB.settings.volume = lastLevel;
      // Browsers only allow an AudioContext to start inside a user gesture — this click is it.
      audioInit();
      sndFlip();
    }
    paintSound();
    setVolume();
    saveDB();
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
  app.querySelector('#studybtn')!.addEventListener('click', studyPage);
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
  const poolnum = app.querySelector('#poolcount') as HTMLElement;
  // Default to the whole selection and let the player trim DOWN, rather than starting at an
  // arbitrary 20 they have to drag up every time.
  if (typeof S.cfg.count !== 'number') S.cfg.count = 0;
  // Cards in the currently-selected scope — the slider's real ceiling. Picking fewer labels has to
  // shrink the max, or "length" could exceed how many cards the selection actually contains.
  // A UNION over labels: a card carrying two selected labels is still one card.
  const scopeCount = (): number => {
    const sc = S.cfg.scope;
    if (sc === 'fav') return CARDS.filter((c) => DB.favorites[c.id]).length;
    if (Array.isArray(sc)) return CARDS.filter((c) => sc.some((l) => c.labels.includes(l))).length;
    return CARDS.length;
  };
  const syncLen = (): void => {
    const cnt = scopeCount();
    const max = Math.max(5, cnt);
    len.max = String(max);
    let v = Number.parseInt(len.value, 10);
    // 0 is the "not yet chosen" sentinel — open at the top of the current scope.
    if (!Number.isFinite(v) || v <= 0) v = S.cfg.count || max;
    if (v > max) v = max;
    len.value = String(v);
    S.cfg.count = v;
    lennum.textContent = v >= cnt ? `All (${cnt})` : `${v} cards`;
    // Rolling pool size: how many cards the current section/role selection contains, live as you toggle.
    poolnum.textContent = `${cnt} total cards`;
  };
  // count 0 = not yet chosen, so open at the top of the scope rather than clamping to the minimum.
  len.value = String(
    S.cfg.count ? Math.min(S.cfg.count, Math.max(5, scopeCount())) : Math.max(5, scopeCount()),
  );
  syncLen();
  len.addEventListener('input', syncLen);
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
