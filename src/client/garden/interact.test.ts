import { beforeEach, describe, expect, test, vi } from 'vitest';

// interact.ts reaches for audio, the page renderer, and the autotiler — none of which these tests care
// about. Stub them so applyBrush's RULES run without a Web Audio graph or a DOM re-render. (setup.ts
// mocks sound for the quiz modes, but not sndDig/sndPlant/sndWater, which only the garden uses.)
vi.mock('../audio/sound.js', () => ({
  sndDig: vi.fn(),
  sndPlant: vi.fn(),
  sndWater: vi.fn(),
  sndWrong: vi.fn(),
}));
vi.mock('./page.js', () => ({ gardenPage: vi.fn() }));
vi.mock('./autotile.js', () => ({ recomputeAutotile: vi.fn() }));

import { DB, newGarden } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { LAYERS } from './catalog.js';
import { applyBrush } from './interact.js';

/**
 * The support rule has to hold in BOTH directions. Placement already refuses to put a tile on an
 * elevation layer without solid support directly beneath it — but a real bug let you dig that support
 * back out from under a tile standing on it, leaving the upper tile floating in a state placement
 * would never have produced. Removal has to protect the same invariant placement enforces.
 */
describe('digging a support block', () => {
  const i = 44; // a middle cell, well away from the board edges

  beforeEach(() => {
    // A valid garden (via the real constructor), then wiped to empty layers so each test controls
    // exactly which cells exist.
    DB.garden = newGarden();
    DB.garden.cells = Array(100).fill(null);
    DB.garden.upper = Array.from({ length: LAYERS - 1 }, () => Array(100).fill(null));
    S.selBrush = { type: 'tool', id: 'dig' };
    S.layer = 0; // editing the ground
  });

  test('is refused when a tile is standing on it', () => {
    DB.garden.cells[i] = { block: 'dirt', v: 0 }; // the support
    DB.garden.upper[0][i] = { block: 'dirt', v: 0 }; // a tile on layer 1, resting on it

    applyBrush(i);

    expect(DB.garden.cells[i]).not.toBeNull(); // the support survived the dig
    expect(DB.garden.upper[0][i]).not.toBeNull(); // and the upper tile was not orphaned
  });

  test('still succeeds when nothing is standing on it', () => {
    DB.garden.cells[i] = { block: 'dirt', v: 0 };
    // layer above is empty at i

    applyBrush(i);

    expect(DB.garden.cells[i]).toBeNull(); // removed as normal
  });

  test('the top layer can always be dug (nothing can stand on it)', () => {
    const top = LAYERS - 1;
    S.layer = top;
    DB.garden.upper[top - 1][i] = { block: 'dirt', v: 0 };

    applyBrush(i);

    expect(DB.garden.upper[top - 1][i]).toBeNull();
  });
});
