// Isometric sprite rendering: tiles, features, trees, animals, the home mini-scene, the board
// inner (art + hit layer + guides), and the hover readout. Ported verbatim.
import { DB, layerCells } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import {
  ANIM_BY_ID,
  ASSET,
  type Animal,
  BLOCKS,
  BOARD_CELLS,
  BOARD_W,
  FEAT_BY_ID,
  type Feature,
  type GardenCell,
  ISO_HX,
  ISO_HY,
  ISO_LIFT,
  ISO_OX,
  ISO_W,
  LAYERS,
  TIMG,
  Z_STEP,
  colOf,
  rowOf,
  supportsUpper,
  waterMask,
} from './catalog.js';

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
  const r = rowOf(i);
  const c = colOf(i);
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
// An empty tile's fill signals whether the current brush could go there: 'open' = faint place-here
// fill, 'blocked' = a mid-air elevation slot over no ground (not-allowed), 'none' = view mode, where
// nothing is being placed so empties show no affordance at all.
export type HitFill = 'open' | 'blocked' | 'none';
export function hitCell(cell: GardenCell | null, i: number, layer = 0, fill: HitFill = 'open'): string {
  const p = cellPos(i, layer);
  const cls = cell ? '' : fill === 'open' ? ' empty' : fill === 'blocked' ? ' void' : '';
  return `<button class="gcell${cls}" data-i="${i}" style="left:${p.x}px;top:${p.y}px" aria-label="tile ${colOf(i)},${rowOf(i)}"></button>`;
}
function gGuides(): string {
  let h = '';
  for (let k = 0; k < BOARD_W; k++) {
    const cp = cellPos(k);
    const rp = cellPos(k * BOARD_W);
    h += `<span class="gguide gg-col" data-c="${k}" style="left:${cp.x + ISO_HX * 1.5}px;top:${cp.y + ISO_HY * 0.5}px">${k}</span>`;
    h += `<span class="gguide gg-row" data-r="${k}" style="left:${rp.x + ISO_HX * 0.5}px;top:${rp.y + ISO_HY * 0.5}px">${k}</span>`;
  }
  return h;
}
/** Debug overlay: each cell's sprite index, and for water its autotile bitmask (m=…). */
function tileIdOverlay(): string {
  const C = DB.garden.cells;
  let h = '';
  for (let i = 0; i < BOARD_CELLS; i++) {
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
  // The active layer is greyed/masked against only while EDITING (a brush is held). With nothing
  // selected the board is in view-all: every layer full colour, no dim, no red — see the "View" tool.
  const editing = !!S.selBrush;
  const L = S.layer;
  let art = '';
  for (let i = 0; i < BOARD_CELLS; i++) {
    for (let layer = 0; layer < LAYERS; layer++) {
      // In view-all, or on the active layer, paint live. The layer directly BELOW the active one is
      // the support layer: it greys out, and turns red where nothing can be built on it. Every other
      // layer just greys. Drawn in layer order at the same i, but z-index (footprint + layer) is what
      // actually orders the stack — DOM order is irrelevant.
      let tint: Tint;
      if (!editing || layer === L) tint = 'live';
      else if (layer === L - 1) tint = supportsUpper(layerCells(G, layer)[i]) ? 'dim' : 'no';
      else tint = 'dim';
      art += cellArt(layerCells(G, layer)[i], i, layer, false, tint);
    }
  }
  const active = layerCells(G, L);
  const hit = active
    .map((c, i) => {
      const fill: HitFill = !editing
        ? 'none' // view mode: no place-here affordance
        : L === 0 || supportsUpper(layerCells(G, L - 1)[i])
          ? 'open'
          : 'blocked';
      return hitCell(c, i, L, fill);
    })
    .join('');
  return gGuides() + art + hit + (S.showTileIds ? tileIdOverlay() : '');
}
export function gardenArt(): string {
  // Display only (home mini-board): every layer, always foreground, full colour.
  const G = DB.garden;
  let out = '';
  for (let i = 0; i < BOARD_CELLS; i++)
    for (let layer = 0; layer < LAYERS; layer++) out += cellArt(layerCells(G, layer)[i], i, layer, true);
  return out;
}
// Plain-english description of everything on a tile of the ACTIVE layer, for the hover readout.
export function tileDesc(i: number): string {
  const L = S.layer;
  const cell = layerCells(DB.garden, L)[i];
  const loc = `col ${colOf(i)} · row ${rowOf(i)}${L ? ` · layer ${L + 1}` : ''}`;
  if (!cell) {
    if (L > 0 && !supportsUpper(layerCells(DB.garden, L - 1)[i])) return `${loc} — nothing below to build on`;
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
