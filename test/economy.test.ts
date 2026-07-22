import { beforeEach, describe, expect, test } from 'vitest';
import { APPLY_COST, BG_PRICE, REWARD_BASE } from '../src/client/garden/catalog.js';
import {
  applyDecor,
  breakCombo,
  clearDecor,
  grantReward,
  unlockDecor,
} from '../src/client/garden/economy.js';
import { DB } from '../src/client/runtime/db.js';
import { S } from '../src/client/runtime/state.js';

/**
 * The payout rules. These exist because a real bug lived here: correct inverse-recall answers were
 * recorded but never paid, because `REWARD_BASE` had no `iv` entry and renderIV never called
 * grantReward. Nothing caught it — the mode still "worked", it just silently paid zero.
 *
 * The first test below is the one that would have caught it, and it is deliberately written against
 * the LIST of machine-graded modes rather than against today's keys: adding an eighth mode without
 * a payout should fail this suite, not ship.
 */

// Every mode whose answer the machine grades. 'fb' is excluded on purpose — it is self-graded, so
// paying for it would pay the honour system rather than the answer.
const MACHINE_GRADED_MODES = ['bf', 'cz', 'iv', 'ma', 'ms', 'fl', 'cg', 'cw', 'cs'];

beforeEach(() => {
  DB.coins = 0;
  DB.combo = 0;
  // The garden ships with an infinite-money mode ON by default, which makes afford() always true.
  // The wallet rules only mean anything with it off, so that is what these tests exercise.
  DB.infinite = false;
  S.ses = null;
  S.curLimit = 0; // timer off — no speed bonus, so payouts are the flat base
});

describe('REWARD_BASE', () => {
  test('every machine-graded mode has a payout', () => {
    const missing = MACHINE_GRADED_MODES.filter((m) => !(m in REWARD_BASE));
    expect(missing, `modes with no entry in REWARD_BASE: ${missing.join(', ')}`).toEqual([]);
  });

  test('self-graded recall is deliberately absent', () => {
    expect(REWARD_BASE.fb).toBeUndefined();
  });

  test('no payout is zero or negative', () => {
    for (const [mode, coins] of Object.entries(REWARD_BASE)) {
      expect(coins, `${mode} pays ${coins}`).toBeGreaterThan(0);
    }
  });
});

describe('grantReward', () => {
  test.each(MACHINE_GRADED_MODES)('%s pays its base and advances the combo', (mode) => {
    grantReward(mode);
    expect(DB.coins).toBe(REWARD_BASE[mode]);
    expect(DB.combo).toBe(1);
  });

  test('an unknown mode falls back to a token payout rather than paying nothing', () => {
    grantReward('not-a-mode');
    expect(DB.coins).toBe(6);
  });

  test('the combo multiplies a streak', () => {
    // Five correct answers in a row pay strictly more than five times the base, because the combo
    // multiplier compounds. The exact curve is comboMult's business; that it RISES is the contract.
    for (let i = 0; i < 5; i++) grantReward('bf');
    expect(DB.combo).toBe(5);
    expect(DB.coins).toBeGreaterThan(5 * REWARD_BASE.bf);
  });
});

describe('breakCombo', () => {
  test('a wrong answer resets the streak but never takes coins away', () => {
    grantReward('ma');
    const earned = DB.coins;
    expect(DB.combo).toBe(1);

    breakCombo();

    expect(DB.combo).toBe(0);
    expect(DB.coins).toBe(earned); // you keep what you earned
  });
});

/**
 * Decor: the backdrop and the particle effect. These were six near-identical functions (one trio per
 * slot) and are now one parameterised trio — so the rules are tested once, for both slots, and the
 * two can no longer drift apart. That drift is not hypothetical: `resetGarden` still clears `bg` and
 * leaves `fx` behind.
 */
describe.each(['bg', 'fx'] as const)('decor: %s', (slot) => {
  const ledger = () => (slot === 'bg' ? DB.ownedBg : DB.ownedFx);

  beforeEach(() => {
    DB.ownedBg = {};
    DB.ownedFx = {};
    DB.garden.bg = null;
    DB.garden.fx = null;
  });

  test('cannot unlock what you cannot afford', () => {
    DB.coins = 0;
    expect(unlockDecor(slot, 'x')).toBe(false);
    expect(ledger().x).toBeUndefined();
  });

  test('unlocking charges once and is owned forever', () => {
    DB.coins = BG_PRICE;
    expect(unlockDecor(slot, 'x')).toBe(true);
    expect(DB.coins).toBe(0);
    expect(ledger().x).toBe(true);

    // Already owned: succeeds, and is free.
    expect(unlockDecor(slot, 'x')).toBe(true);
    expect(DB.coins).toBe(0);
  });

  test('cannot apply what you do not own', () => {
    DB.coins = 10_000;
    expect(applyDecor(slot, 'x')).toBe(false);
    expect(DB.garden[slot]).toBeNull();
  });

  test('applying an owned item charges the apply cost and sets the slot', () => {
    ledger().x = true;
    DB.coins = APPLY_COST;
    expect(applyDecor(slot, 'x')).toBe(true);
    expect(DB.coins).toBe(0);
    expect(DB.garden[slot]).toBe('x');
  });

  test('re-applying the item that is already active is refused, and charges nothing', () => {
    ledger().x = true;
    DB.garden[slot] = 'x';
    DB.coins = 10_000;
    expect(applyDecor(slot, 'x')).toBe(false);
    expect(DB.coins).toBe(10_000);
  });

  test('clearing is free and keeps the unlock', () => {
    ledger().x = true;
    DB.garden[slot] = 'x';
    DB.coins = 5;

    clearDecor(slot);

    expect(DB.garden[slot]).toBeNull();
    expect(DB.coins).toBe(5);
    expect(ledger().x, 'you keep what you bought').toBe(true);
  });
});
