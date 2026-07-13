// Shared coin wallet + garden value, multi-garden purchase/switching, and background purchase.
// Wallet (coins/combo/infinite/spent) lives on DB (shared across gardens); DB.garden is the
// active board.
import { DB, saveDB, newGarden } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { REWARD_BASE, BLOCK_VALUE, FEAT_BY_ID, ANIM_BY_ID, newBoard, BG_PRICE, APPLY_COST } from './catalog.js';

export function comboMult(): number {
  return Math.min(1 + Math.max(0, DB.combo - 1) * 0.5, 5);
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
  const base = REWARD_BASE[mode] || 6;
  let coins = base;
  if (S.curLimit > 0) {
    const usedSec = ((S.answeredAt || Date.now()) - S.cardStart) / 1000;
    const speed = S.ses && S.ses.timeSpeed ? S.ses.timeSpeed : 1;
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
  cm.textContent = '\u{1F525} ' + DB.combo + ' ×' + comboMult().toFixed(1);
  cm.classList.toggle('hot', DB.combo >= 2);
  cm.classList.add('pulse');
  setTimeout(() => cm.classList.remove('pulse'), 350);
  cp.querySelector('.cb-coins')!.classList.add('roll');
  setTimeout(() => cp.querySelector('.cb-coins')!.classList.remove('roll'), 400);
}
export function coinToast(n: number): void {
  const t = document.createElement('div');
  t.className = 'cointoast';
  t.textContent = '+' + n + ' \u{1FA99}';
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('go'), 20);
  setTimeout(() => t.remove(), 1400);
}
/** Reset the ACTIVE garden's board (keeps the shared wallet); money defaults back to on. */
export function resetGarden(): void {
  DB.garden.cells = newBoard();
  DB.garden.hideFg = false;
  DB.garden.bg = null;
  DB.infinite = true;
  S.selBrush = null;
  saveDB();
}
/** A selected background or effect each add this to a garden's value (applying improves the score). */
export const DECOR_VALUE = 200;
function gardenValueOf(g: import('../runtime/db.js').Garden): number {
  let v = 0;
  for (let i = 0; i < 100; i++) {
    const c = g.cells[i];
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
  v = Math.max(0, v - 25 * BLOCK_VALUE.dirt); // subtract the free 5x5 dirt starter
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
export const NEW_GARDEN_COST = 3000;
export const GARDEN_STEP = 1500; // total-value increment that unlocks each new garden
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
  saveDB();
  return true;
}
export function switchGarden(idx: number): void {
  if (idx < 0 || idx >= DB.gardens.length) return;
  DB.gardenIdx = idx;
  DB.garden = DB.gardens[idx];
  saveDB();
}
/** Track the best TOTAL garden value reached across all gardens (gates new-garden purchases). */
export function updateMaxScore(): void {
  const v = totalGardenValue();
  if (v > (DB.maxScore || 0)) DB.maxScore = v;
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
  DB.infinite = true;
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
