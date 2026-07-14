import { describe, expect, test } from 'vitest';
import { autotile } from './autotile.js';
import { BLOCKS, type GardenCell, WATER_MAP, isLand, waterMask } from './catalog.js';

/**
 * The autotiler is the only real algorithm in the garden — a 16-entry lookup keyed by which of a
 * water tile's four edges face land — and it had no tests, because it read the global DB instead of
 * taking a board. Now it takes the board, so all sixteen masks can be table-tested against a plain
 * array.
 */

const EMPTY: (GardenCell | null)[] = Array(100).fill(null);
const board = (): (GardenCell | null)[] => EMPTY.slice();
const put = (b: (GardenCell | null)[], r: number, c: number, block: string): void => {
  b[r * 10 + c] = { block, v: -1 };
};
const at = (b: (GardenCell | null)[], r: number, c: number): GardenCell => b[r * 10 + c]!;

// The four edges of the cell at (r,c), in bit order: NE=1, NW=2, SE=4, SW=8.
const EDGES: [string, number, number, number][] = [
  ['NE', -1, 0, 1],
  ['NW', 0, -1, 2],
  ['SE', 0, 1, 4],
  ['SW', 1, 0, 8],
];

describe('isLand', () => {
  test('a non-water block is land', () => {
    expect(isLand({ block: 'grass', v: 0 })).toBe(true);
    expect(isLand({ block: 'spire', v: 0 })).toBe(true);
  });

  test('water, and the void, are not', () => {
    expect(isLand({ block: 'water', v: 0 })).toBe(false);
    expect(isLand(null)).toBe(false);
  });
});

describe('waterMask', () => {
  test.each(EDGES)('land to the %s sets bit %d… (dr=%d)', (_name, dr, dc, bit) => {
    const b = board();
    put(b, 5, 5, 'water');
    put(b, 5 + dr, 5 + dc, 'grass');
    expect(waterMask(b, 55)).toBe(bit);
  });

  test('open water — no land on any edge — is mask 0', () => {
    const b = board();
    put(b, 5, 5, 'water');
    expect(waterMask(b, 55)).toBe(0);
  });

  test('land on every edge is mask 15', () => {
    const b = board();
    put(b, 5, 5, 'water');
    for (const [, dr, dc] of EDGES) put(b, 5 + dr, 5 + dc, 'grass');
    expect(waterMask(b, 55)).toBe(15);
  });

  test('water neighbours are not land, so they raise no rim', () => {
    const b = board();
    put(b, 5, 5, 'water');
    for (const [, dr, dc] of EDGES) put(b, 5 + dr, 5 + dc, 'water');
    expect(waterMask(b, 55)).toBe(0);
  });

  test('the board edge is not land — a corner tile has no phantom rim', () => {
    // Cell 0 is the top-left corner: its NE and NW neighbours are off-board entirely.
    const b = board();
    put(b, 0, 0, 'water');
    expect(waterMask(b, 0)).toBe(0);
  });
});

describe('autotile — water', () => {
  test.each(Object.keys(WATER_MAP).map(Number))('mask %d picks its mapped tile', (mask) => {
    const b = board();
    put(b, 5, 5, 'water');
    for (const [, dr, dc, bit] of EDGES) {
      if (mask & bit) put(b, 5 + dr, 5 + dc, 'grass');
    }
    autotile(b);
    expect(at(b, 5, 5).v).toBe(WATER_MAP[mask]);
  });

  test('an unmapped edge combination falls back to the full rim rather than a hole', () => {
    // 7 (NE+NW+SE) is not in WATER_MAP.
    expect(WATER_MAP[7]).toBeUndefined();
    const b = board();
    put(b, 5, 5, 'water');
    put(b, 4, 5, 'grass'); // NE
    put(b, 5, 4, 'grass'); // NW
    put(b, 5, 6, 'grass'); // SE
    autotile(b);
    expect(at(b, 5, 5).v).toBe(113);
  });

  test('leaves land tiles alone', () => {
    const b = board();
    b[55] = { block: 'grass', v: 24 };
    autotile(b);
    expect(at(b, 5, 5).v).toBe(24);
  });
});

describe('autotile — spire', () => {
  test('shows its wet base when both FRONT edges are water', () => {
    const b = board();
    put(b, 5, 5, 'spire');
    put(b, 5, 6, 'water'); // SE
    put(b, 6, 5, 'water'); // SW
    autotile(b);
    expect(at(b, 5, 5).v).toBe(72);
  });

  test('shows its dry base as soon as ONE front edge is land', () => {
    const b = board();
    put(b, 5, 5, 'spire');
    put(b, 5, 6, 'grass'); // SE is land
    put(b, 6, 5, 'water'); // SW is water
    autotile(b);
    expect(at(b, 5, 5).v).toBe(64);
  });

  test('the BACK edges do not matter — they are behind the spire and cannot be seen', () => {
    const b = board();
    put(b, 5, 5, 'spire');
    put(b, 4, 5, 'grass'); // NE — land, but behind
    put(b, 5, 4, 'grass'); // NW — land, but behind
    autotile(b);
    expect(at(b, 5, 5).v).toBe(72); // still wet: both FRONT edges are empty
  });
});

describe('the block table is the single source of truth', () => {
  test('every block has a name and a positive price', () => {
    for (const [id, b] of Object.entries(BLOCKS)) {
      expect(b.name, `${id} has a name`).toBeTruthy();
      expect(b.price, `${id} is worth something`).toBeGreaterThan(0);
    }
  });

  test('grass is in the table but not for sale — it is grown by watering dirt', () => {
    expect(BLOCKS.grass).toBeDefined();
    expect(BLOCKS.grass.buyable).toBe(false);
  });

  test('every water tile the autotiler can produce is a real tile id', () => {
    for (const v of Object.values(WATER_MAP)) expect(v).toBeGreaterThan(0);
  });
});
