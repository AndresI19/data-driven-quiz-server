// Isometric sprite rendering: tiles, features, trees, animals, the home mini-scene, the board
// inner (art + hit layer + guides), and the hover readout. Ported verbatim.
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import {
  ANIM_BY_ID,
  ASSET,
  type Animal,
  BLOCKS,
  FEAT_BY_ID,
  type Feature,
  type GardenCell,
  ISO_HX,
  ISO_HY,
  ISO_LIFT,
  ISO_OX,
  ISO_W,
  TIMG,
  Z_STEP,
  supportsUpper,
  waterMask,
} from './catalog.js';

// Mini isometric 4x4 all-grass render for the home button: tree N, stag S, rock E, log W.
export function fabScene(): string {
  const HX = 11;
  const HY = 5.5;
  const OX = 3 * HX;
  const win = (img: string, fw: number, fh: number, dh: number): string => {
    const s = dh / fh;
    return `background-image:url(${img});width:${Math.round(fw * s)}px;height:${dh}px;background-size:auto ${dh}px`;
  };
  let out = '';
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      const x = (c - r) * HX + OX;
      const y = (r + c) * HY;
      const z = r + c;
      let deco = '';
      if (r === 0 && c === 0)
        deco = `<span class="fabobj" style="${win(`${ASSET}decor/tree/pine_GREEN.png`, 53, 96, 30)};bottom:46%"></span>`;
      else if (r === 0 && c === 3)
        deco = `<img class="fabobj2" src="${TIMG(53)}" style="width:18px;bottom:36%">`;
      else if (r === 3 && c === 3)
        deco = `<span class="fabobj" style="${win(`${ASSET}critters/stag_d0.png`, 32, 35, 16)};bottom:38%"></span>`;
      else if (r === 3 && c === 0)
        deco = `<img class="fabobj2" src="${TIMG(48)}" style="width:18px;bottom:36%">`;
      out += `<span class="fabtile" style="left:${x}px;top:${y}px;z-index:${z};background-image:url(${TIMG(24)})">${deco}</span>`;
    }
  return `<span class="fabscene">${out}</span>`;
}
const stagger = (i: number, k: number): string => (((i * k) % 20) * 0.19).toFixed(2); // desync repeats
export function animSprite(a: Animal, dir?: number, i?: number): string {
  dir = dir || 0;
  i = i || 0;
  const s = ISO_W / 48;
  const w = Math.round(a.fw * s);
  const h = Math.round(a.fh * s); // one scale for all → natural relative sizes
  const tx = a.flip ? w : 0;
  const sx = a.flip ? -s : s; // mirror so every animal faces the same way
  return `<span class="ganim" style="width:${w}px;height:${h}px"><span class="ganimf anim-${a.id}" style="width:${a.fw}px;height:${a.fh}px;background-image:url(${ASSET}critters/${a.id}_d${dir}.png);transform:translateX(${tx}px) scale(${sx.toFixed(3)},${s.toFixed(3)});animation-delay:-${stagger(i, 7)}s"></span></span>`;
}
export function treeSprite(f: Feature, i?: number): string {
  i = i || 0;
  const s = (ISO_W * 1.85) / f.tfh!;
  const w = Math.round(f.tfw! * s);
  const h = Math.round(f.tfh! * s);
  return `<span class="gtree" style="width:${w}px;height:${h}px"><span class="gtreef anim-tree-${f.ttype}" style="width:${f.tfw}px;height:${f.tfh}px;background-image:url(${ASSET}decor/tree/${f.ttype}_${f.color}.png);transform:scale(${s.toFixed(3)});animation-delay:-${stagger(i, 11)}s"></span></span>`;
}
export function animThumb(a: Animal): string {
  // Fit the CONTENT box (non-transparent pixels of frame 0) to the cell, not the padded frame —
  // otherwise the wolf, whose sprite floats in a wide 64px frame, would render tiny. Every
  // animal then reads at a consistent height (the wolf now matches the stag beside it).
  const s = Math.min(58 / a.cw, 46 / a.ch);
  const w = Math.round(a.cw * s);
  const h = Math.round(a.ch * s);
  // Shift the strip so frame 0's content lands at the box's top-left, then scale about that corner.
  return `<span class="ganim" style="position:static;left:auto;bottom:auto;transform:none;width:${w}px;height:${h}px;overflow:visible"><span class="ganimf anim-${a.id}" style="width:${a.fw}px;height:${a.fh}px;background-image:url(${ASSET}critters/${a.id}_d0.png);transform-origin:top left;transform:scale(${s.toFixed(3)}) translate(${-a.cx}px,${-a.cy}px)"></span></span>`;
}
export function cellPos(i: number, layer = 0): { x: number; y: number; z: number } {
  const r = (i / 10) | 0;
  const c = i % 10;
  // Lift the elevation layer one cube; sort by footprint first, layer only as a tiebreak.
  return {
    x: (c - r) * ISO_HX + ISO_OX,
    y: (c + r) * ISO_HY - layer * ISO_LIFT,
    z: Z_STEP * (c + r) + layer,
  };
}
// A pack decor sprite (free-standing PNG) sized to the tile and bottom-anchored on its surface.
function packSprite(f: Feature): string {
  const tW = ISO_W * (f.cat === 'tree' ? 0.78 : 0.92);
  const tH = ISO_W * (f.cat === 'tree' ? 1.75 : 0.85);
  const s = Math.min(tW / f.w!, tH / f.h!);
  const w = Math.round(f.w! * s);
  const h = Math.round(f.h! * s);
  return `<img class="gpack" src="${ASSET}decor/${f.cat}/${f.file}" style="width:${w}px;height:${h}px" alt="" draggable="false">`;
}
function featSprite(f: Feature, i: number): string {
  if (f.tree) return treeSprite(f, i);
  if (f.pack) return packSprite(f);
  if (f.cover) return `<img class="gfeat cover" src="${TIMG(f.t!)}" alt="" draggable="false">`;
  return `<img class="gfeat obj" src="${TIMG(f.t!)}" alt="" draggable="false">`; // bottom-anchored
}
/** How to paint a cell relative to the active layer: full colour, greyed (inactive), or greyed with a
    red "cannot build here" wash on the tile's top face. */
export type Tint = 'live' | 'dim' | 'no';
// Art layer: the visual tile (+feature +animal), pointer-events off, painted back-to-front.
export function cellArt(
  cell: GardenCell | null,
  i: number,
  layer = 0,
  forceFg?: boolean,
  tint: Tint = 'live',
): string {
  if (!cell) return '';
  const p = cellPos(i, layer);
  const fg = forceFg || !DB.garden.hideFg;
  let inner = `<img class="gtile-img" src="${TIMG(cell.v)}" alt="" draggable="false">`;
  // The red wash sits ON the tile top, UNDER any feature — it flags the ground, not what stands on it.
  if (tint === 'no') inner += '<span class="gtint no"></span>';
  if (fg && cell.feature) {
    const f = FEAT_BY_ID[cell.feature];
    if (f) inner += featSprite(f, i);
  }
  if (fg && cell.animal) {
    const a = ANIM_BY_ID[cell.animal];
    if (a) inner += animSprite(a, cell.adir || 0, i);
  }
  const cls = tint === 'live' ? '' : ' dim';
  return `<div class="gart${cls}" data-i="${i}" data-l="${layer}" style="left:${p.x}px;top:${p.y}px;z-index:${p.z}">${inner}</div>`;
}
// Hit layer: a diamond-clipped button per tile — tessellates exactly, so a click maps to one tile.
// `open` marks an empty tile the current brush could fill (faint fill); a mid-air elevation slot with
// no supporting ground below is NOT open, so it shows no "place here" affordance.
export function hitCell(cell: GardenCell | null, i: number, layer = 0, open = true): string {
  const p = cellPos(i, layer);
  const empty = !cell ? (open ? ' empty' : ' void') : '';
  return `<button class="gcell${empty}" data-i="${i}" style="left:${p.x}px;top:${p.y}px" aria-label="tile ${i % 10},${(i / 10) | 0}"></button>`;
}
function gGuides(): string {
  let h = '';
  for (let k = 0; k < 10; k++) {
    const cp = cellPos(k);
    const rp = cellPos(k * 10);
    h += `<span class="gguide gg-col" data-c="${k}" style="left:${cp.x + ISO_HX * 1.5}px;top:${cp.y + ISO_HY * 0.5}px">${k}</span>`;
    h += `<span class="gguide gg-row" data-r="${k}" style="left:${rp.x + ISO_HX * 0.5}px;top:${rp.y + ISO_HY * 0.5}px">${k}</span>`;
  }
  return h;
}
/** Debug overlay: each cell's sprite index, and for water its autotile bitmask (m=…). */
function tileIdOverlay(): string {
  const C = DB.garden.cells;
  let h = '';
  for (let i = 0; i < 100; i++) {
    const cell = C[i];
    if (!cell) continue;
    const p = cellPos(i);
    let label = String(cell.v);
    if (cell.block === 'water') {
      // The SAME mask the autotiler used to choose the tile. Computed here independently, the
      // overlay could disagree with the tile it is labelling — which defeats the overlay.
      label = `${cell.v}·m${waterMask(C, i)}`;
    }
    h += `<span class="tileid" style="left:${p.x + ISO_HX}px;top:${p.y + ISO_HY}px">${label}</span>`;
  }
  return h;
}

export function gardenBoardInner(): string {
  const G = DB.garden;
  const L = S.layer; // the layer being edited; the other renders greyed and non-interactive
  let art = '';
  for (let i = 0; i < 100; i++) {
    // Ground: live when editing it; when editing elevation, greyed — and red where nothing can be
    // built on top of it (water, a spire, or an occupied tile).
    const groundTint: Tint = L === 0 ? 'live' : supportsUpper(G.cells[i]) ? 'dim' : 'no';
    art += cellArt(G.cells[i], i, 0, false, groundTint);
    // Elevation: live when editing it, greyed otherwise. Drawn after ground at the same i, but its
    // z-index (footprint + layer) is what actually orders it — DOM order is irrelevant.
    art += cellArt(G.upper[i], i, 1, false, L === 1 ? 'live' : 'dim');
  }
  const active = L === 0 ? G.cells : G.upper;
  const hit = active.map((c, i) => hitCell(c, i, L, L === 0 || supportsUpper(G.cells[i]))).join('');
  return gGuides() + art + hit + (S.showTileIds ? tileIdOverlay() : '');
}
export function gardenArt(): string {
  // Display only (home mini-board): both layers, always foreground, full colour.
  const G = DB.garden;
  let out = '';
  for (let i = 0; i < 100; i++) {
    out += cellArt(G.cells[i], i, 0, true);
    out += cellArt(G.upper[i], i, 1, true);
  }
  return out;
}
// Plain-english description of everything on a tile of the ACTIVE layer, for the hover readout.
export function tileDesc(i: number): string {
  const L = S.layer;
  const cell = (L === 0 ? DB.garden.cells : DB.garden.upper)[i];
  const loc = `col ${i % 10} · row ${(i / 10) | 0}${L ? ' · elevation' : ''}`;
  if (!cell) {
    if (L === 1 && !supportsUpper(DB.garden.cells[i])) return `${loc} — no ground below to build on`;
    return `${loc} — empty`;
  }
  // The block's name comes from the block table — this was a third copy of it, and the only reason
  // it existed is that `grass` used to be missing from BLOCKS.
  const bn = BLOCKS[cell.block]?.name || cell.block;
  const parts = [bn];
  if (cell.feature) {
    const f = FEAT_BY_ID[cell.feature];
    if (f) parts.push(f.name);
  }
  if (cell.animal) {
    const a = ANIM_BY_ID[cell.animal];
    if (a) parts.push(a.name);
  }
  return `${loc} — ${parts.join(' · ')}`;
}
