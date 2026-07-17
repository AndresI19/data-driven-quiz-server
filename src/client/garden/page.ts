import { setup } from '../pages/home.js';
import { leavePlay } from '../quiz/pause.js';
// The garden editor page: garden switcher, palette (tools/blocks/plants+wood/trees/rocks/animals/
// backgrounds — each row scrolls horizontally to stay compact), the board, hover row/column
// highlight, tool cursors, and all its wiring.
import { COIN, CURRENCY } from '../runtime/currency.js';
import { app } from '../runtime/data.js';
import { DB, saveDB } from '../runtime/db.js';
import { setPath } from '../runtime/router.js';
import { S } from '../runtime/state.js';
import { setKey } from '../runtime/util.js';
import {
  ANIMALS,
  APPLY_COST,
  ASSET,
  type Animal,
  BACKGROUNDS,
  BG_PRICE,
  BG_URL,
  BLOCKS,
  BOARD_PX_W,
  EFFECTS,
  type Effect,
  FEATURES,
  FEAT_BY_ID,
  FX_URL,
  type Feature,
  LAYERS,
  NEW_GARDEN_COST,
  TIMG,
  TOOL_IMG,
  TREE_COLORS,
  TREE_PRICE,
  WATER_COST,
  WATER_OPEN,
  colOf,
  rowOf,
} from './catalog.js';
import {
  type Decor,
  applyDecor,
  buyGarden,
  canBuyGarden,
  clearDecor,
  gardenValue,
  nextGardenThreshold,
  resetGarden,
  switchGarden,
  totalGardenValue,
  unlockDecor,
  updateMaxScore,
} from './economy.js';
import { exportGardenGif } from './export-gif.js';
import { claimGrants, guestWatermarkHtml, mailButtonHtml } from './grants.js';
import { applyBrush, brushHint, brushSel, costTag } from './interact.js';
import { setScreenBg } from './screenbg.js';
import { startSplashes } from './splash.js';
import { animThumb, gardenBoardInner, tileDesc } from './sprites.js';

// Hotspot (px) per tool cursor, in each PNG's own pixels (cursors render at natural size).
const TOOL_HOTSPOT: Record<string, [number, number]> = {
  water: [51, 7], // spout rose (55×36 can, pour point at top-right)
  dig: [6, 32], // blade tip (shovel is flipped, blade at bottom)
  rotate: [4, 4], // jaw
};

/** Cursor CSS for the current brush: the tool/tile image (same sprite the menu shows). */
function brushCursor(): string {
  const b = S.selBrush;
  if (!b) return '';
  if (b.type === 'tool') {
    const [hx, hy] = TOOL_HOTSPOT[b.id] || [16, 16];
    return `url("${TOOL_IMG[b.id]}") ${hx} ${hy}, crosshair`;
  }
  if (b.type === 'block') {
    const s = BLOCKS[b.id];
    const spr = b.id === 'water' ? WATER_OPEN : s.pool![0];
    return `url("${TIMG(spr)}") 16 24, crosshair`;
  }
  if (b.type === 'feature') {
    const f = FEAT_BY_ID[b.id];
    if (f && f.t != null && !f.tree && !f.pack) return `url("${TIMG(f.t)}") 16 24, crosshair`;
  }
  return 'crosshair';
}

/** One tab per layer, highest on top down to the ground (F1), mirroring the physical stack. Scales
    with LAYERS — adding a layer adds its tab automatically. */

/**
 * Fit the board to the room the column actually has, and keep it fitted.
 *
 * The board is a fixed 800px art box (BOARD_PX_W, derived from the projection) inside a column that is
 * min(1440px, 92vw) wide. On a 390px phone that is ~362px of room for 800px of garden, and before this
 * the surplus was simply lost: `justify-content: center` on the scroller pushed 219px of the west
 * corner to a NEGATIVE offset, where scrollLeft cannot reach. `safe center` in game.css fixes the
 * reachability; this makes the whole garden visible without panning at all.
 *
 * WHY JS AND NOT CSS. A scale is a ratio, and CSS cannot reliably make one: dividing a length by a
 * number yields a length, so `clamp(0.34, calc((92vw - 28px) / 800), 1)` is a type error that browsers
 * discard silently — the element just computes to 0x0. Six lines here beat a formula that fails without
 * saying so.
 *
 * ResizeObserver rather than `resize`: the question is whether THIS column changed width, which a
 * window event neither implies nor is required for (a scrollbar appearing, or the panel opening, does
 * it with no resize at all). No feedback loop — the wrapper is sized by the page's column, never by the
 * board it holds.
 *
 * `zoom` is a user multiplier ON TOP of the fit. Above 1 the board overflows again and pans, which is
 * correct and only works because of `safe center`.
 */
function fitBoard(): void {
  const wrap = app.querySelector<HTMLElement>('.boardwrap');
  if (!wrap) return;
  const apply = (): void => {
    const room = wrap.clientWidth;
    if (!room) return; // not laid out yet; the observer will call again when it is
    // Full size by default, panned to navigate — the board is NOT shrunk to fit the screen. The
    // fit-to-screen scale read as a tiny garden; at 1 the board keeps its real 800px and the west
    // corner stays reachable because .boardwrap uses `safe center` (the bug #46 fixed). Zoom still
    // multiplies from here. (`room` above is the "laid out yet?" guard.)
    wrap.style.setProperty('--gbw', `${BOARD_PX_W}px`);
    wrap.style.setProperty('--gfit', String(S.gardenZoom));
  };
  apply();
  // Open centred on the garden — the old default. Now that the board is full-size and overflows,
  // `safe center` left-aligns it, so without this the first thing on screen is the empty top-left of
  // the isometric bounding box. Done once, after layout; the observer below never re-centres, so a
  // resize (or the user's own pan) is left alone.
  requestAnimationFrame(() => {
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  });
  new ResizeObserver(apply).observe(wrap);
}

function layerTabs(): string {
  let h = '';
  for (let L = LAYERS - 1; L >= 0; L--) {
    const on = S.layer === L;
    h += `<button class="ltab l${L + 1}${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-layer="${L}">F${L + 1}</button>`;
  }
  return h;
}

/**
 * Enter the garden editor from elsewhere (router, home button). Distinct from gardenPage(), which is
 * also the in-place re-render after every edit: entering drops you on the ground layer, but a
 * re-render must preserve whichever layer you had tabbed into.
 */
export function enterGarden(): void {
  S.layer = 0;
  gardenPage();
}

export function gardenPage(): void {
  leavePlay();
  setPath('/garden');
  setScreenBg(true);
  // Total value across all gardens: summed once here and reused for both the max-score bump and the
  // 🏆 readout below (it walks every garden × cell × layer, so computing it twice per render adds up).
  const total = totalGardenValue();
  updateMaxScore(total);
  const G = DB.garden;
  const palTool = (id: string, label: string, cost: number | null): string =>
    `<button class="palbtn tool${brushSel('tool', id)}" data-bt="tool" data-bi="${id}"><span class="palico-wrap"><img class="palico-img" src="${TOOL_IMG[id]}" draggable="false" alt=""></span><span class="pallab">${label}</span><span class="palcost">${cost == null ? 'free' : `${COIN}${cost}`}</span></button>`;
  // The "View" tool: the first item in the shop. It selects nothing — clicking it clears the brush,
  // which drops the board into view-all (every layer in full colour, no layer tabs). It reads as
  // selected whenever no brush is held. Placeholder eyeball SVG for now; swap for a PNG icon later.
  const EYE_SVG =
    '<svg class="palico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const palView = (): string =>
    `<button class="palbtn tool viewtool${S.selBrush ? '' : ' sel'}" id="toolview" title="deselect — just view the garden"><span class="palico-wrap">${EYE_SVG}</span><span class="pallab">View</span><span class="palcost">free</span></button>`;
  const palBlock = (id: string): string => {
    const s = BLOCKS[id];
    const spr = id === 'water' ? WATER_OPEN : s.pool![0];
    return `<button class="palbtn${brushSel('block', id)}" data-bt="block" data-bi="${id}"><img class="palimg" src="${TIMG(spr)}" draggable="false" alt=""><span class="pallab">${s.name}</span><span class="palcost">${COIN}${s.price}</span></button>`;
  };
  const palFeat = (f: Feature): string => {
    const img = f.pack ? `${ASSET}decor/${f.cat}/${f.file}` : TIMG(f.t!);
    const thumb = `<img class="palimg" src="${img}" draggable="false" alt="">`;
    return `<button class="palbtn${brushSel('feature', f.id)}" data-bt="feature" data-bi="${f.id}"><span class="palimgwrap">${thumb}</span><span class="pallab">${f.name}</span><span class="palcost">${costTag(f.price)}</span></button>`;
  };
  const palTree = (cc: [string, string]): string => {
    const [COLOR, name] = cc;
    const tfw = 74;
    const tfh = 128;
    const ts = Math.min(46 / tfw, 46 / tfh);
    const th = Math.round(tfh * ts);
    const thumb = `<span class="paltree" style="width:${Math.round(tfw * ts)}px;height:${th}px;background-image:url(${ASSET}decor/tree/spruce_${COLOR}.png);background-size:auto ${th}px;background-position:0 0"></span>`;
    return `<button class="palbtn${brushSel('tree', COLOR)}" data-bt="tree" data-bi="${COLOR}"><span class="palimgwrap">${thumb}</span><span class="pallab">${name}</span><span class="palcost">${COIN}${TREE_PRICE}</span></button>`;
  };
  const palAnimal = (a: Animal): string =>
    `<button class="palbtn animrow${brushSel('animal', a.id)}" data-bt="animal" data-bi="${a.id}"><span class="palanim">${animThumb(a)}</span><span class="pallab">${a.name}</span><span class="palcost prem">${COIN}${a.price}</span></button>`;
  const palBg = (): string => {
    const none = `<button class="palbtn bgbtn${G.bg == null ? ' sel' : ''}" data-bg="__none"><span class="palbgthumb none">∅</span><span class="pallab">None</span><span class="palcost">free</span></button>`;
    const items = BACKGROUNDS.map((bg) => {
      const owned = !!DB.ownedBg[bg.id];
      const active = G.bg === bg.id;
      const cost = active ? 'active' : owned ? `${COIN}${APPLY_COST} apply` : `\u{1F512} ${COIN}${BG_PRICE}`;
      return `<button class="palbtn bgbtn${active ? ' sel' : ''}${owned ? '' : ' locked'}" data-bg="${bg.id}"><span class="palbgthumb" style="background-image:url(${BG_URL(bg.id)})"></span><span class="pallab">${bg.name}</span><span class="palcost${owned ? '' : ' prem'}">${cost}</span></button>`;
    }).join('');
    return none + items;
  };
  const palFx = (): string => {
    const none = `<button class="palbtn fxbtn${G.fx == null ? ' sel' : ''}" data-fx="__none"><span class="palimgwrap"><span class="palbgthumb none">∅</span></span><span class="pallab">None</span><span class="palcost">free</span></button>`;
    const items = EFFECTS.map((e: Effect) => {
      const owned = !!DB.ownedFx[e.id];
      const active = G.fx === e.id;
      const cost = active ? 'active' : owned ? `${COIN}${APPLY_COST} apply` : `\u{1F512} ${COIN}${BG_PRICE}`;
      const th = 34;
      const preview = `<span class="palfxthumb" style="width:${e.fw}px;height:${e.fh}px;background-image:url(${FX_URL(e.id)});animation:fx-spin-${e.id} ${e.dur}s steps(${e.n}) infinite;transform:scale(${(th / e.fw).toFixed(2)})"></span>`;
      return `<button class="palbtn fxbtn${active ? ' sel' : ''}${owned ? '' : ' locked'}" data-fx="${e.id}"><span class="palimgwrap">${preview}</span><span class="pallab">${e.name}</span><span class="palcost${owned ? '' : ' prem'}">${cost}</span></button>`;
    }).join('');
    return none + items;
  };
  const plants = FEATURES.filter(
    (f) => !f.tree && (f.sec === 'Bushes' || f.sec === 'Flowers' || f.sec === 'Wood'),
  );
  const rocks = FEATURES.filter((f) => f.sec === 'Rocks');
  const buyBtn = canBuyGarden()
    ? `<button class="btn primary sm" id="gbuy" title="start a fresh garden">+ New garden (${COIN}${NEW_GARDEN_COST})</button>`
    : `<span class="tiny gslot">next garden at \u{1F3C6} ${nextGardenThreshold()} total</span>`;
  app.innerHTML = `<div class="wrap gardenwrap">
    <!-- Guest watermark (position:fixed, top-right under the login FAB). Its spot in the markup is
         immaterial; it lives here so the route swap that replaces app.innerHTML tears it down when you
         leave the garden. The mail button is in-flow below, between the toolbar and the board. -->
    ${guestWatermarkHtml()}
    <div class="rvbar">
      <!-- Returns to the quiz's own home screen (setup), not the platform home page — so it is
           labelled "Back" rather than "Home", which would collide with the top-left home link. -->
      <button class="btn ghost sm" id="gback" title="back to the quiz home screen">← Back</button>
      <div class="coinbal big">${COIN} ${DB.infinite ? '∞' : DB.coins}</div>
      <span class="gscore big" title="achievement — total value across ALL your gardens (unlocks new gardens)">\u{1F3C6} ${total}</span>
      <span class="gscore" title="this garden's value">\u{1F3C5} ${gardenValue()}</span>
      <button class="btn ghost sm${G.hideFg ? ' on' : ''}" id="ghide" title="hide plants &amp; animals to work at block level">\u{1F332} ${G.hideFg ? 'hidden' : 'shown'}</button>
      <button class="btn ghost sm" id="gexport" title="download an animated GIF of the garden">\u{1F3AC} GIF</button>
      <button class="btn ghost sm danger" id="greset">Reset</button>
    </div>
    <div class="gswitch">
      <button class="btn ghost sm" id="gprev" ${DB.gardenIdx === 0 ? 'disabled' : ''} title="previous garden">←</button>
      <span class="gswitch-lab">Garden ${DB.gardenIdx + 1} / ${DB.gardens.length}</span>
      <button class="btn ghost sm" id="gnext" ${DB.gardenIdx >= DB.gardens.length - 1 ? 'disabled' : ''} title="next garden">→</button>
      ${buyBtn}
    </div>
    <!-- Welcome-coin mail button: in-flow below the Back button and above the garden board. Empty
         string once claimed or for a guest, so no dead icon lingers. -->
    ${mailButtonHtml()}
    <div class="boardwrap">
      <!-- Zoom. Multiplies the fit rather than setting an absolute scale, so "1x" means the whole
           garden at every width and the control never has to know the viewport. Zooming in overflows
           the scroller and pans — which works only because .boardwrap uses safe center. -->
      <div class="gzoom" role="group" aria-label="zoom">
        <button class="gz" id="gzout" type="button" aria-label="zoom out">&minus;</button>
        <button class="gz gzlvl" id="gzfit" type="button" aria-label="fit the whole garden">${Math.round(S.gardenZoom * 100)}%</button>
        <button class="gz" id="gzin" type="button" aria-label="zoom in">+</button>
      </div>
      <div class="gfit"><div class="gboard">${gardenBoardInner()}</div>
      <!-- Layer tabs — shown only while a brush is selected (editing). Highest layer on top, ground
           (F1) at the bottom, mirroring the physical stack; only the tabbed-into layer is editable,
           the others render greyed. With no brush selected the board is already in view-all, so the
           tabs are hidden. "View all" here is hold-to-preview: while held, every layer shows in full
           colour without leaving the layer you are editing.

           INSIDE .gfit, not .boardwrap. Its right:0 needs a containing block that IS the board; against
           the scroller that resolved to the viewport's right edge, so the tabs landed in the middle of
           the board and then scrolled away from it. .gfit is the board's real (scaled) box. -->
      ${
        S.selBrush
          ? `<div class="ltabs" role="tablist" aria-label="editing layer">
        ${layerTabs()}
        <button class="ltab viewall" id="lviewall" type="button" title="hold to preview every layer in colour">View all</button>
      </div>`
          : ''
      }
      </div>
    </div>
    <div class="palhint" id="palhint">${brushHint()}</div>
    <div class="palette">
      <div class="palgroup"><div class="palh">Tools</div><div class="palrow">${palView()}${palTool('water', 'Water → grass', WATER_COST)}${palTool('dig', 'Shovel', null)}${palTool('rotate', 'Wrench', null)}</div></div>
      <div class="palgroup"><div class="palh">Blocks — fill an empty tile</div><div class="palrow">${palBlock('dirt')}${palBlock('rock')}${palBlock('spire')}${palBlock('water')}</div></div>
      <div class="palgroup"><div class="palh">Plants &amp; wood — on grass / dirt</div><div class="palrow">${plants.map(palFeat).join('')}</div></div>
      <div class="palgroup"><div class="palh">Trees — 6 colours · a random tree type is planted</div><div class="palrow">${TREE_COLORS.map(palTree).join('')}</div></div>
      <div class="palgroup"><div class="palh">Rocks — on grass, dirt or rock</div><div class="palrow">${rocks.map(palFeat).join('')}</div></div>
      <div class="palgroup"><div class="palh">Animals — premium · animated · not on trees</div><div class="palrow">${ANIMALS.map(palAnimal).join('')}</div></div>
      <div class="palgroup"><div class="palh">Backgrounds — ${COIN}${BG_PRICE} unlock · ${COIN}${APPLY_COST} to apply (raises 🏆) · full-screen on garden + home</div><div class="palrow">${palBg()}</div></div>
      <div class="palgroup"><div class="palh">Effects — ${COIN}${BG_PRICE} unlock · ${COIN}${APPLY_COST} to apply (raises 🏆) · falling particles on garden + home</div><div class="palrow">${palFx()}</div></div>
    </div>
  </div>`;
  fitBoard();

  // Zoom is clamped to [1, 3]: 1 is the whole garden (never smaller — there is no reason to want less
  // than all of it), 3 is enough to place a tile precisely on a phone, where the fitted tap diamond is
  // only ~33x16.
  const zoom = (mult: number): void => {
    S.gardenZoom = Math.min(3, Math.max(1, Math.round((S.gardenZoom + mult) * 10) / 10));
    const lvl = app.querySelector<HTMLElement>('#gzfit');
    if (lvl) lvl.textContent = `${Math.round(S.gardenZoom * 100)}%`;
    fitBoard();
  };
  app.querySelector('#gzout')?.addEventListener('click', () => zoom(-0.5));
  app.querySelector('#gzin')?.addEventListener('click', () => zoom(0.5));
  app.querySelector('#gzfit')?.addEventListener('click', () => {
    S.gardenZoom = 1;
    zoom(0);
  });

  app.querySelector('#gback')!.addEventListener('click', () => {
    S.selBrush = null;
    setup();
  });
  app.querySelector('#ghide')!.addEventListener('click', () => {
    G.hideFg = !G.hideFg;
    saveDB();
    gardenPage();
  });
  app.querySelector('#greset')!.addEventListener('click', () => {
    if (confirm(`Reset this garden's tiles back to the 5×5 starter? (Your ${CURRENCY.many} are kept.)`)) {
      resetGarden();
      gardenPage();
    }
  });
  app.querySelector('#gexport')!.addEventListener('click', exportGardenGif);
  // Claim welcome coins straight from the mail button — no dialog; claimGrants shows a fade message
  // and is a no-op when nothing is pending, so clicking an already-read mailbox does nothing.
  app.querySelector('#gmail')?.addEventListener('click', claimGrants);
  app.querySelector('#gprev')!.addEventListener('click', () => {
    switchGarden(DB.gardenIdx - 1);
    gardenPage();
  });
  app.querySelector('#gnext')!.addEventListener('click', () => {
    switchGarden(DB.gardenIdx + 1);
    gardenPage();
  });
  const gbuy = app.querySelector('#gbuy');
  if (gbuy)
    gbuy.addEventListener('click', () => {
      if (buyGarden()) gardenPage();
    });
  app.querySelectorAll<HTMLElement>('.ltab[data-layer]').forEach((t) =>
    t.addEventListener('click', () => {
      const next = +t.dataset.layer!;
      if (next === S.layer) return;
      S.layer = next;
      gardenPage();
    }),
  );
  // "View all" is hold-to-preview: while the pointer is down, the board drops its layer greying/red
  // mask (a pure CSS class, no re-render) so every layer reads in full colour. Release restores the
  // active-layer view. Pointer capture routes the release back to the button even if the pointer
  // wanders off it — so all listeners stay on this element and are GC'd with it on the next render
  // (no window-level listeners accumulating across re-renders).
  const viewAll = app.querySelector<HTMLElement>('#lviewall');
  const board = app.querySelector<HTMLElement>('.gboard');
  if (viewAll && board) {
    const peek = (on: boolean): void => {
      board.classList.toggle('peekall', on);
      viewAll.classList.toggle('held', on);
    };
    viewAll.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // don't start a text selection / focus drag
      try {
        viewAll.setPointerCapture(e.pointerId); // enhancement only — ignore if this pointer can't be captured
      } catch {}
      peek(true);
    });
    const end = (): void => peek(false);
    viewAll.addEventListener('pointerup', end);
    viewAll.addEventListener('pointercancel', end);
    viewAll.addEventListener('lostpointercapture', end);
    // Keyboard parity: hold Space/Enter while the button is focused.
    viewAll.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') peek(true);
    });
    viewAll.addEventListener('keyup', end);
    viewAll.addEventListener('blur', end);
  }
  // The "View" tool selects nothing — it clears the brush, which drops the board into view-all.
  app.querySelector('#toolview')?.addEventListener('click', () => {
    S.selBrush = null;
    gardenPage();
  });
  app.querySelectorAll('.palbtn:not(.bgbtn):not(.fxbtn):not(.viewtool)').forEach((b) =>
    b.addEventListener('click', () => {
      const el = b as HTMLElement;
      S.selBrush = { type: el.dataset.bt!, id: el.dataset.bi! };
      gardenPage();
    }),
  );
  // One shop rule for both decor slots: '__none' clears, an un-owned item unlocks on the first
  // click, and an owned one applies on the second.
  const wireDecor = (slot: Decor, sel: string, owned: Record<string, boolean>): void => {
    app.querySelectorAll(sel).forEach((b) =>
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset[slot]!;
        if (id === '__none') clearDecor(slot);
        else if (!owned[id]) unlockDecor(slot, id);
        else applyDecor(slot, id);
        gardenPage();
      }),
    );
  };
  wireDecor('fx', '.fxbtn', DB.ownedFx);
  wireDecor('bg', '.bgbtn', DB.ownedBg);
  const hint = app.querySelector('#palhint');
  const cells = app.querySelectorAll<HTMLElement>('.gcell');
  const cursor = brushCursor();
  cells.forEach((b) => {
    if (cursor) b.style.cursor = cursor;
    const i = +b.dataset.i!;
    const c = colOf(i);
    const r = rowOf(i);
    /* WHICH TILE AM I ON. All four channels — the #palhint readout, the row/column cross-highlight,
       .cell-hot, and the axis guides — used to hang off mouseenter alone, so on a phone every one of
       them was dead. The garden was reachable and still unusable: you tapped blind, and :hover is the
       ONLY thing that says which of two overlapping diamonds the pointer resolves to. It matters more
       after the fit, not less — the tap target is a 80x40 diamond scaled to ~36x18. */
    const show = (): void => {
      if (hint) hint.textContent = tileDesc(i);
      cells.forEach((x) => {
        const j = +x.dataset.i!;
        x.classList.toggle('rc', colOf(j) === c || rowOf(j) === r);
      });
      cells.forEach((x) => x.classList.remove('cell-hot'));
      b.classList.add('cell-hot');
      app.querySelectorAll('.gguide.hot').forEach((x) => x.classList.remove('hot'));
      app.querySelector(`.gg-col[data-c="${c}"]`)?.classList.add('hot');
      app.querySelector(`.gg-row[data-r="${r}"]`)?.classList.add('hot');
    };
    const clear = (): void => {
      if (hint) hint.textContent = brushHint();
      cells.forEach((x) => x.classList.remove('rc', 'cell-hot'));
      app.querySelectorAll('.gguide.hot').forEach((x) => x.classList.remove('hot'));
    };

    b.addEventListener('click', () => applyBrush(i));
    b.addEventListener('mouseenter', show);
    b.addEventListener('mouseleave', clear);

    /* Touch has no enter and no leave — it has a tap. So the tap does the telling, on pointerdown, an
       instant BEFORE the click applies the brush: you see which tile resolved and what was there, and
       it stays on screen afterwards rather than being wiped by a leave that never comes. Mouse is
       excluded because it already has the real thing above; a pen gets it, which is right — a stylus
       cannot hover either. */
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') show();
    });
  });
  // Mouse-wheel over a scrollable shop row scrolls it horizontally.
  app.querySelectorAll<HTMLElement>('.palrow').forEach((row) => {
    row.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY === 0 || row.scrollWidth <= row.clientWidth) return;
        e.preventDefault();
        row.scrollLeft += e.deltaY;
      },
      { passive: false },
    );
  });
  setKey((e) => {
    if (e.key === 'ArrowLeft' && DB.gardenIdx > 0) {
      switchGarden(DB.gardenIdx - 1);
      gardenPage();
    } else if (e.key === 'ArrowRight' && DB.gardenIdx < DB.gardens.length - 1) {
      switchGarden(DB.gardenIdx + 1);
      gardenPage();
    } else if (e.key === 'Escape') {
      S.selBrush = null;
      setup();
    }
  });
  startSplashes();
}
