import { sndDig, sndPlant, sndWater, sndWrong } from '../audio/sound.js';
import { COIN, CURRENCY } from '../runtime/currency.js';
// Garden interaction: the brush model (tools/blocks/features/animals), placement rules, refunds,
// and the palette hint/warn strings. Ported verbatim.
import { app } from '../runtime/data.js';
import { DB, layerCells, saveDB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { pick } from '../runtime/util.js';
import { recomputeAutotile } from './autotile.js';
import {
  ANIM_BY_ID,
  BLOCKS,
  BLOCK_VALUE,
  FEAT_BY_ID,
  GRASS_V,
  LAYERS,
  TREE_COLORS,
  TREE_PRICE,
  TREE_TYPE_IDS,
  WATER_COST,
  WATER_OPEN,
  supportsUpper,
} from './catalog.js';
import { afford, refund, spend } from './economy.js';
import { gardenPage } from './page.js';

export function nudge(sel: string): void {
  const el = app.querySelector(sel);
  if (el) {
    el.classList.add('nudge');
    setTimeout(() => el.classList.remove('nudge'), 450);
  }
}
export function warn(msg: string): void {
  const h = app.querySelector('#palhint');
  if (h) {
    h.textContent = msg;
    h.classList.add('warn');
    clearTimeout(S.warnTimer as ReturnType<typeof setTimeout>);
    S.warnTimer = setTimeout(() => h.classList.remove('warn'), 1800);
  }
  sndWrong();
}
export function applyBrush(i: number): void {
  const L = S.layer; // active editing layer
  const C = layerCells(DB.garden, L); // the cells the brush actually edits
  const below = L > 0 ? layerCells(DB.garden, L - 1) : null; // the layer this one keys onto (support)
  const cell = C[i];
  const b = S.selBrush;
  if (!b) {
    nudge('.palette');
    return warn('Pick a tool or item below first.');
  }
  const done = (): void => {
    recomputeAutotile();
    saveDB();
    gardenPage();
  };
  if (b.type === 'tool' && b.id === 'water') {
    if (!cell || cell.block !== 'dirt') return warn('Watering only works on a DIRT tile.');
    if (!afford(WATER_COST)) return warn(`Not enough ${COIN} ${CURRENCY.many} — answer cards to earn more.`);
    spend(WATER_COST);
    cell.block = 'grass';
    cell.v = pick(GRASS_V);
    sndWater();
    done();
    return;
  }
  if (b.type === 'tool' && b.id === 'dig') {
    // shovel: peel one layer per click, refunding half the cost
    if (!cell) return warn('Nothing here to dig.');
    if (cell.animal) {
      const a = ANIM_BY_ID[cell.animal];
      if (a) refund(a.price);
      cell.animal = null;
    } else if (cell.feature) {
      const f = FEAT_BY_ID[cell.feature];
      if (f) refund(f.price);
      cell.feature = null;
    } else {
      // A block can't be dug out from under a tile that is standing on it — that would leave the
      // upper tile floating. Placement already requires solid support directly beneath (see the block
      // branch below); removal has to protect that same support, or the two rules disagree and the
      // garden can reach a state placement would never have allowed.
      const above = L < LAYERS - 1 ? layerCells(DB.garden, L + 1) : null;
      if (above?.[i]) return warn('Something is built on top — dig the tile above first.');
      refund(BLOCK_VALUE[cell.block] || 0);
      C[i] = null;
    }
    sndDig();
    done();
    return;
  }
  if (b.type === 'tool' && b.id === 'rotate') {
    // wrench: turn an animal to face a new way, else cycle a dirt/rock variant
    if (cell?.animal) {
      cell.adir = ((cell.adir || 0) + 1) % 4;
      sndDig();
      done();
      return;
    }
    if (cell && (cell.block === 'dirt' || cell.block === 'rock')) {
      const pool = BLOCKS[cell.block].pool!;
      const k = (pool.indexOf(cell.v) + 1) % pool.length;
      cell.v = pool[k];
      sndDig();
      done();
      return;
    }
    return warn('Wrench turns animals, or varies a dirt/rock tile.');
  }
  if (b.type === 'block') {
    if (cell) return warn('That tile is full — dig it back to empty first.');
    // Elevation rules (same on every layer above the ground): no water up here, and a tile needs
    // solid support directly beneath it on the layer below.
    if (below) {
      if (b.id === 'water') return warn("Water can't go on an elevation layer.");
      if (!supportsUpper(below[i]))
        return warn('Nothing to build on — the tile below is empty, water, a spire, or occupied.');
    }
    const spec = BLOCKS[b.id];
    if (!afford(spec.price)) return warn(`Not enough ${COIN} ${CURRENCY.many} — answer cards to earn more.`);
    spend(spec.price);
    if (b.id === 'water') {
      C[i] = { block: 'water', v: WATER_OPEN };
    } else C[i] = { block: b.id, v: pick(spec.pool!) };
    // Grass shaded under a new elevated tile loses its light and reverts to dirt.
    if (below && below[i]!.block === 'grass') {
      below[i]!.block = 'dirt';
      below[i]!.v = pick(BLOCKS.dirt.pool!);
    }
    sndPlant();
    done();
    return;
  }
  if (b.type === 'feature') {
    const f = FEAT_BY_ID[b.id];
    if (!cell) return warn(`Put a block there first — ${f.name} needs ${f.on.join('/')}.`);
    if (cell.feature) return warn('That tile already has a feature — dig it first.');
    if (f.on.indexOf(cell.block) < 0) return warn(`${f.name} goes on ${f.on.join('/')}, not ${cell.block}.`);
    if (!afford(f.price)) return warn(`Not enough ${COIN} ${CURRENCY.many} — answer cards to earn more.`);
    spend(f.price);
    cell.feature = f.id;
    sndPlant();
    done();
    return;
  }
  if (b.type === 'tree') {
    // b.id is a COLOUR; plant a random tree TYPE of that colour.
    if (!cell) return warn('Put a block there first — a tree needs grass or dirt.');
    if (cell.feature) return warn('That tile already has a feature — dig it first.');
    if (cell.block !== 'grass' && cell.block !== 'dirt')
      return warn(`Trees go on grass or dirt, not ${cell.block}.`);
    if (!afford(TREE_PRICE)) return warn(`Not enough ${COIN} ${CURRENCY.many} — answer cards to earn more.`);
    spend(TREE_PRICE);
    cell.feature = `tr_${pick(TREE_TYPE_IDS)}_${b.id}`;
    sndPlant();
    done();
    return;
  }
  if (b.type === 'animal') {
    if (!cell) return warn('No tile there — animals need a land tile.');
    if (cell.block === 'water') return warn("Animals can't stand on water.");
    if (cell.feature) {
      const f = FEAT_BY_ID[cell.feature];
      if (f?.tree) return warn("Animals can't stand where a tree is — dig it first.");
    }
    if (cell.animal) return warn('There is already an animal on that tile.');
    const a = ANIM_BY_ID[b.id];
    if (!afford(a.price)) return warn(`Not enough ${COIN} ${CURRENCY.many} — answer cards to earn more.`);
    spend(a.price);
    cell.animal = a.id;
    sndPlant();
    done();
    return;
  }
}
export function brushSel(t: string, id: string): string {
  return S.selBrush && S.selBrush.type === t && S.selBrush.id === id ? ' sel' : '';
}
export function brushHint(): string {
  if (!S.selBrush) return 'Pick a tool or item below, then tap a tile.';
  const b = S.selBrush;
  if (b.type === 'tool') {
    if (b.id === 'water') return `Tap a DIRT tile to water it into grass (${COIN}${WATER_COST}).`;
    if (b.id === 'dig')
      return 'Tap a tile to peel one layer — animal, feature, then block — for half the cost back.';
    if (b.id === 'rotate') return 'Tap an animal to turn it, or a dirt/rock tile to cycle its variant.';
  }
  if (b.type === 'tree') {
    const col = TREE_COLORS.find((c) => c[0] === b.id);
    return `Tap a grass/dirt tile to plant a random ${col ? col[1] : ''} tree.`;
  }
  if (b.type === 'block') return `Tap an EMPTY tile to place ${BLOCKS[b.id].name}.`;
  if (b.type === 'feature') {
    const f = FEAT_BY_ID[b.id];
    return `Tap a ${f.on.join('/').toUpperCase()} tile to place ${f.name}.`;
  }
  if (b.type === 'animal') return `Tap a land tile to release the ${ANIM_BY_ID[b.id].name}.`;
  return '';
}
export function costTag(p: number): string {
  return p ? `${COIN}${p}` : 'free';
}
