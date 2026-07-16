// Shared coin wallet + garden value, multi-garden purchase/switching, and background purchase.
// Wallet (coins/combo/infinite/spent) lives on DB (shared across gardens); DB.garden is the
// active board.
import { COIN } from '../runtime/currency.js';
import { DB, emptyElevation, newGarden, saveDB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import {
  ANIM_BY_ID,
  APPLY_COST,
  BG_PRICE,
  BLOCK_VALUE,
  BOARD_CELLS,
  COMBO_CAP,
  COMBO_STEP,
  DECOR_VALUE,
  FEAT_BY_ID,
  GARDEN_STEP,
  NEW_GARDEN_COST,
  REWARD_BASE,
  REWARD_DEFAULT,
  newBoard,
} from './catalog.js';

export function comboMult(): number {
  return Math.min(1 + Math.max(0, DB.combo - 1) * COMBO_STEP, COMBO_CAP);
} // caps at 5x (combo 9)
export function afford(n: number): boolean {
  return DB.infinite || DB.coins >= n;
}
export function spend(n: number): void {
  if (DB.infinite) return;
  DB.coins -= n;
  DB.spent = (DB.spent || 0) + n;
}
export function breakCombo(): void {
  if (DB.combo) {
    DB.combo = 0;
    saveDB();
    updateCoinBar();
  }
}
export function grantReward(mode: string): void {
  DB.combo = (DB.combo || 0) + 1;
  const base = REWARD_BASE[mode] || REWARD_DEFAULT;
  let coins = base;
  if (S.curLimit > 0) {
    const usedSec = ((S.answeredAt || Date.now()) - S.cardStart) / 1000;
    const speed = S.ses?.timeSpeed ? S.ses.timeSpeed : 1;
    coins += Math.round(base * Math.max(0, (S.curLimit - usedSec) / S.curLimit) * speed);
  }
  coins = Math.round(coins * comboMult());
  DB.coins += coins;
  if (S.ses) S.ses.coins = (S.ses.coins || 0) + coins;
  saveDB();
  coinToast(coins);
  updateCoinBar();
}
export function updateCoinBar(): void {
  const cp = document.getElementById('coinbar');
  if (!cp) return;
  cp.querySelector('.cb-coins')!.textContent = DB.infinite ? '∞' : String(DB.coins);
  const cm = cp.querySelector('.cb-combo') as HTMLElement;
  cm.textContent = `\u{1F525} ${DB.combo} ×${comboMult().toFixed(1)}`;
  cm.classList.toggle('hot', DB.combo >= 2);
  cm.classList.add('pulse');
  setTimeout(() => cm.classList.remove('pulse'), 350);
  cp.querySelector('.cb-coins')!.classList.add('roll');
  setTimeout(() => cp.querySelector('.cb-coins')!.classList.remove('roll'), 400);
}
export function coinToast(n: number): void {
  const t = document.createElement('div');
  t.className = 'cointoast';
  t.textContent = `+${n} ${COIN}`;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('go'), 20);
  setTimeout(() => t.remove(), 1400);
}
/** Reset the ACTIVE garden's board (keeps the shared wallet); money defaults back to on. */
export function resetGarden(): void {
  DB.garden.cells = newBoard();
  DB.garden.upper = emptyElevation();
  DB.garden.hideFg = false;
  DB.garden.bg = null;
  // No longer forces free money on. Resetting a garden is not a reason to hand out unlimited
  // currency — that was part of the same god-mode-by-default bug.
  S.selBrush = null;
  saveDB();
}
function gardenValueOf(g: import('../runtime/db.js').Garden): number {
  const layerValue = (cells: (import('./catalog.js').GardenCell | null)[]): number => {
    let v = 0;
    for (let i = 0; i < BOARD_CELLS; i++) {
      const c = cells[i];
      if (!c) continue;
      v += BLOCK_VALUE[c.block] || 0;
      if (c.feature) {
        const f = FEAT_BY_ID[c.feature];
        if (f) v += f.price;
      }
      if (c.animal) {
        const a = ANIM_BY_ID[c.animal];
        if (a) v += a.price;
      }
    }
    return v;
  };
  // The ground carries a free 5x5 dirt starter that shouldn't count; every elevation layer is all paid.
  let v = Math.max(0, layerValue(g.cells) - 25 * BLOCK_VALUE.dirt);
  for (const up of g.upper) v += layerValue(up);
  if (g.bg) v += DECOR_VALUE;
  if (g.fx) v += DECOR_VALUE;
  return v;
}
/** Value of the active garden. */
export function gardenValue(): number {
  return gardenValueOf(DB.garden);
}
/** Value summed across ALL gardens — this is what gates buying new ones (so it's reachable). */
export function totalGardenValue(): number {
  return DB.gardens.reduce((s, g) => s + gardenValueOf(g), 0);
}
export function refund(n: number): void {
  const h = Math.floor(n / 2);
  DB.coins += h;
  DB.spent = Math.max(0, (DB.spent || 0) - h);
}

// ---- multiple gardens ----
/** How many gardens are unlocked: one, plus one per GARDEN_STEP of best-ever TOTAL value. */
export function gardenSlots(): number {
  return 1 + Math.floor((DB.maxScore || 0) / GARDEN_STEP);
}
export function canBuyGarden(): boolean {
  return DB.gardens.length < gardenSlots();
}
export function buyGarden(): boolean {
  if (!canBuyGarden() || !afford(NEW_GARDEN_COST)) return false;
  spend(NEW_GARDEN_COST);
  DB.gardens.push(newGarden());
  DB.gardenIdx = DB.gardens.length - 1;
  DB.garden = DB.gardens[DB.gardenIdx];
  S.layer = 0; // a fresh garden has no elevation yet
  saveDB();
  return true;
}
export function switchGarden(idx: number): void {
  if (idx < 0 || idx >= DB.gardens.length) return;
  DB.gardenIdx = idx;
  DB.garden = DB.gardens[idx];
  S.layer = 0; // a different garden has its own elevation content — start on the ground
  saveDB();
}
/** Track the best TOTAL garden value reached across all gardens (gates new-garden purchases). Accepts
    an already-computed total so a caller that just summed it (the garden render) need not recompute. */
export function updateMaxScore(total: number = totalGardenValue()): void {
  if (total > (DB.maxScore || 0)) DB.maxScore = total;
}
/** Threshold (total 🏆) at which the next garden slot unlocks. */
export function nextGardenThreshold(): number {
  return DB.gardens.length * GARDEN_STEP;
}
/** Debug: wipe ALL garden progress — extra gardens, backgrounds, coins, unlocks. */
export function resetAllGardens(): void {
  DB.gardens = [newGarden()];
  DB.gardenIdx = 0;
  DB.garden = DB.gardens[0];
  DB.ownedBg = {};
  DB.ownedFx = {};
  DB.coins = 0;
  DB.spent = 0;
  DB.combo = 0;
  DB.maxScore = 0;
  DB.infinite = false;
  S.selBrush = null;
  saveDB();
}

// ---------------------------------------------------------------------------------------------
// Decor: the backdrop and the falling-particle effect.
//
// Both are bought the same way — unlock once (BG_PRICE, yours forever), then apply to the current
// garden (APPLY_COST, which is what lifts the 🏆 score). The two used to be written out twice, six
// near-identical functions differing only in which dictionary they looked in and which field of the
// garden they set. That is what a parameter is for.
// ---------------------------------------------------------------------------------------------

/** The two decor slots. A slot names both the garden field and the ownership ledger. */
export type Decor = 'bg' | 'fx';

const OWNED: Record<Decor, () => Record<string, boolean>> = {
  bg: () => DB.ownedBg,
  fx: () => DB.ownedFx,
};

/** Buy the right to use a decor item. Idempotent: already owning it is success, and costs nothing. */
export function unlockDecor(slot: Decor, id: string): boolean {
  const owned = OWNED[slot]();
  if (owned[id]) return true;
  if (!afford(BG_PRICE)) return false;
  spend(BG_PRICE);
  owned[id] = true;
  saveDB();
  return true;
}

/** Put an owned item on the current garden. Fails if it is not owned, or is already the active one. */
export function applyDecor(slot: Decor, id: string): boolean {
  if (!OWNED[slot]()[id] || DB.garden[slot] === id) return false;
  if (!afford(APPLY_COST)) return false;
  spend(APPLY_COST);
  DB.garden[slot] = id;
  saveDB();
  return true;
}

/** Take it off. Free — you keep the unlock. */
export function clearDecor(slot: Decor): void {
  DB.garden[slot] = null;
  saveDB();
}
