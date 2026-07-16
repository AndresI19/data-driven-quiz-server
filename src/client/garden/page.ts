import { setup } from '../pages/home.js';
import { dismissTransients } from '../quiz/pause.js';
import { stopTicker } from '../quiz/timer.js';
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
  EFFECTS,
  type Effect,
  FEATURES,
  FEAT_BY_ID,
  FX_URL,
  type Feature,
  LAYERS,
  TIMG,
  TOOL_IMG,
  TREE_COLORS,
  TREE_PRICE,
  WATER_COST,
  WATER_OPEN,
} from './catalog.js';
import {
  type Decor,
  NEW_GARDEN_COST,
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
  stopTicker();
  S.running = false;
  dismissTransients();
  setPath('/garden');
  setScreenBg(true);
  updateMaxScore();
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
    <!-- Welcome-coin mail button (top-left, signed-in only) and the guest watermark under the login
         FAB. Both are position:fixed, so their spot in the markup is immaterial; they live here so the
         route swap that replaces app.innerHTML tears them down when you leave the garden. -->
    ${mailButtonHtml()}${guestWatermarkHtml()}
    <div class="rvbar">
      <!-- Returns to the quiz's own home screen (setup), not the platform home page — so it is
           labelled "Back" rather than "Home", which would collide with the top-left home link. -->
      <button class="btn ghost sm" id="gback" title="back to the quiz home screen">← Back</button>
      <div class="coinbal big">${COIN} ${DB.infinite ? '∞' : DB.coins}</div>
      <span class="gscore big" title="achievement — total value across ALL your gardens (unlocks new gardens)">\u{1F3C6} ${totalGardenValue()}</span>
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
    <div class="boardwrap"><div class="gboard">${gardenBoardInner()}</div>
      <!-- Layer tabs — shown only while a brush is selected (editing). Highest layer on top, ground
           (F1) at the bottom, mirroring the physical stack; only the tabbed-into layer is editable,
           the others render greyed. With no brush selected the board is already in view-all, so the
           tabs are hidden. "View all" here is hold-to-preview: while held, every layer shows in full
           colour without leaving the layer you are editing. -->
      ${
        S.selBrush
          ? `<div class="ltabs" role="tablist" aria-label="editing layer">
        ${layerTabs()}
        <button class="ltab viewall" id="lviewall" type="button" title="hold to preview every layer in colour">View all</button>
      </div>`
          : ''
      }
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
    const c = i % 10;
    const r = (i / 10) | 0;
    b.addEventListener('click', () => applyBrush(i));
    b.addEventListener('mouseenter', () => {
      if (hint) hint.textContent = tileDesc(i);
      cells.forEach((x) => {
        const j = +x.dataset.i!;
        x.classList.toggle('rc', j % 10 === c || ((j / 10) | 0) === r);
      });
      b.classList.add('cell-hot');
      const gc = app.querySelector(`.gg-col[data-c="${c}"]`);
      const gr = app.querySelector(`.gg-row[data-r="${r}"]`);
      if (gc) gc.classList.add('hot');
      if (gr) gr.classList.add('hot');
    });
    b.addEventListener('mouseleave', () => {
      if (hint) hint.textContent = brushHint();
      cells.forEach((x) => x.classList.remove('rc', 'cell-hot'));
      app.querySelectorAll('.gguide.hot').forEach((x) => x.classList.remove('hot'));
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
