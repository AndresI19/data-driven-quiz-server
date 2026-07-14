import { setup } from '../pages/home.js';
import { hidePause } from '../quiz/pause.js';
import { stopTicker } from '../quiz/timer.js';
// The garden editor page: garden switcher, palette (tools/blocks/plants+wood/trees/rocks/animals/
// backgrounds — each row scrolls horizontally to stay compact), the board, hover row/column
// highlight, tool cursors, and all its wiring.
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

export function gardenPage(): void {
  stopTicker();
  S.running = false;
  hidePause();
  setPath('/garden');
  setScreenBg(true);
  updateMaxScore();
  const G = DB.garden;
  const palTool = (id: string, label: string, cost: number | null): string =>
    `<button class="palbtn tool${brushSel('tool', id)}" data-bt="tool" data-bi="${id}"><span class="palico-wrap"><img class="palico-img" src="${TOOL_IMG[id]}" draggable="false" alt=""></span><span class="pallab">${label}</span><span class="palcost">${cost == null ? 'free' : `\u{1FA99}${cost}`}</span></button>`;
  const palBlock = (id: string): string => {
    const s = BLOCKS[id];
    const spr = id === 'water' ? WATER_OPEN : s.pool![0];
    return `<button class="palbtn${brushSel('block', id)}" data-bt="block" data-bi="${id}"><img class="palimg" src="${TIMG(spr)}" draggable="false" alt=""><span class="pallab">${s.name}</span><span class="palcost">\u{1FA99}${s.price}</span></button>`;
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
    return `<button class="palbtn${brushSel('tree', COLOR)}" data-bt="tree" data-bi="${COLOR}"><span class="palimgwrap">${thumb}</span><span class="pallab">${name}</span><span class="palcost">\u{1FA99}${TREE_PRICE}</span></button>`;
  };
  const palAnimal = (a: Animal): string =>
    `<button class="palbtn animrow${brushSel('animal', a.id)}" data-bt="animal" data-bi="${a.id}"><span class="palanim">${animThumb(a)}</span><span class="pallab">${a.name}</span><span class="palcost prem">\u{1FA99}${a.price}</span></button>`;
  const palBg = (): string => {
    const none = `<button class="palbtn bgbtn${G.bg == null ? ' sel' : ''}" data-bg="__none"><span class="palbgthumb none">∅</span><span class="pallab">None</span><span class="palcost">free</span></button>`;
    const items = BACKGROUNDS.map((bg) => {
      const owned = !!DB.ownedBg[bg.id];
      const active = G.bg === bg.id;
      const cost = active
        ? 'active'
        : owned
          ? `\u{1FA99}${APPLY_COST} apply`
          : `\u{1F512} \u{1FA99}${BG_PRICE}`;
      return `<button class="palbtn bgbtn${active ? ' sel' : ''}${owned ? '' : ' locked'}" data-bg="${bg.id}"><span class="palbgthumb" style="background-image:url(${BG_URL(bg.id)})"></span><span class="pallab">${bg.name}</span><span class="palcost${owned ? '' : ' prem'}">${cost}</span></button>`;
    }).join('');
    return none + items;
  };
  const palFx = (): string => {
    const none = `<button class="palbtn fxbtn${G.fx == null ? ' sel' : ''}" data-fx="__none"><span class="palimgwrap"><span class="palbgthumb none">∅</span></span><span class="pallab">None</span><span class="palcost">free</span></button>`;
    const items = EFFECTS.map((e: Effect) => {
      const owned = !!DB.ownedFx[e.id];
      const active = G.fx === e.id;
      const cost = active
        ? 'active'
        : owned
          ? `\u{1FA99}${APPLY_COST} apply`
          : `\u{1F512} \u{1FA99}${BG_PRICE}`;
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
    ? `<button class="btn primary sm" id="gbuy" title="start a fresh garden">+ New garden (\u{1FA99}${NEW_GARDEN_COST})</button>`
    : `<span class="tiny gslot">next garden at \u{1F3C6} ${nextGardenThreshold()} total</span>`;
  app.innerHTML = `<div class="wrap gardenwrap">
    <div class="rvbar">
      <!-- Returns to the quiz's own home screen (setup), not the platform home page — so it is
           labelled "Back" rather than "Home", which would collide with the top-left home link. -->
      <button class="btn ghost sm" id="gback" title="back to the quiz home screen">← Back</button>
      <div class="coinbal big">\u{1FA99} ${DB.infinite ? '∞' : DB.coins}</div>
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
    <div class="boardwrap"><div class="gboard">${gardenBoardInner()}</div></div>
    <div class="palhint" id="palhint">${brushHint()}</div>
    <div class="palette">
      <div class="palgroup"><div class="palh">Tools</div><div class="palrow">${palTool('water', 'Water → grass', WATER_COST)}${palTool('dig', 'Shovel', null)}${palTool('rotate', 'Wrench', null)}</div></div>
      <div class="palgroup"><div class="palh">Blocks — fill an empty tile</div><div class="palrow">${palBlock('dirt')}${palBlock('rock')}${palBlock('spire')}${palBlock('water')}</div></div>
      <div class="palgroup"><div class="palh">Plants &amp; wood — on grass / dirt</div><div class="palrow">${plants.map(palFeat).join('')}</div></div>
      <div class="palgroup"><div class="palh">Trees — 6 colours · a random tree type is planted</div><div class="palrow">${TREE_COLORS.map(palTree).join('')}</div></div>
      <div class="palgroup"><div class="palh">Rocks — on grass, dirt or rock</div><div class="palrow">${rocks.map(palFeat).join('')}</div></div>
      <div class="palgroup"><div class="palh">Animals — premium · animated · not on trees</div><div class="palrow">${ANIMALS.map(palAnimal).join('')}</div></div>
      <div class="palgroup"><div class="palh">Backgrounds — \u{1FA99}${BG_PRICE} unlock · \u{1FA99}${APPLY_COST} to apply (raises 🏆) · full-screen on garden + home</div><div class="palrow">${palBg()}</div></div>
      <div class="palgroup"><div class="palh">Effects — \u{1FA99}${BG_PRICE} unlock · \u{1FA99}${APPLY_COST} to apply (raises 🏆) · falling particles on garden + home</div><div class="palrow">${palFx()}</div></div>
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
    if (confirm("Reset this garden's tiles back to the 5×5 starter? (Your coins are kept.)")) {
      resetGarden();
      gardenPage();
    }
  });
  app.querySelector('#gexport')!.addEventListener('click', exportGardenGif);
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
  app.querySelectorAll('.palbtn:not(.bgbtn):not(.fxbtn)').forEach((b) =>
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
