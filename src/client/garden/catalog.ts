// Garden catalog: sprite/tileset metadata and shop data, ported verbatim (same numbers) from
// the original generator. Pure data + a couple of pure helpers — no game state.
import { pick } from '../runtime/util.js';

// ---- Sprite garden: assets under <base>assets/ ----
// BASE_URL is Vite's baked-in prefix (trailing-slashed; '/' at root), so asset URLs resolve whether
// the app is at '/' or behind a proxy path.
export const ASSET = `${import.meta.env.BASE_URL}assets/`;
export const TIMG = (i: number): string => `${ASSET}tiles/tile_${String(i).padStart(3, '0')}.png`;

// Block variant pools — placing a block picks a random member (water is autotiled instead).
export const DIRT_V = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 17, 18, 19, 20, 21, 26];
export const GRASS_V = [22, 23, 24, 28, 39, 40];
export const ROCK_V = [61, 63]; // 62 (round) is decor; 64 (spire) is a block
export const SPIRE_V = [64];
// Directional water autotile. Edge bits: NE=1 (r-1,c) · NW=2 (r,c-1) · SE=4 (r,c+1) · SW=8 (r+1,c);
// a bit is set when that neighbour is LAND (a non-water block; water/empty/off-board = no rim).
export const WATER_MAP: Record<number, number> = {
  0: 104,
  1: 105,
  2: 106,
  4: 107,
  8: 108,
  3: 109,
  12: 110,
  5: 112,
  10: 111,
  15: 113,
}; // NE+SE(5) and NW+SW(10) tiles swapped per playtest
export const WATER_OPEN = 104; // interior (no land edges)

// ---- Board dimensions ----
// Square grid, row-major in a flat array. Single source for its size; everything that walks the board
// (rendering, autotiling, value, splashes) reads these instead of open-coding 10 / 100.
export const BOARD_W = 10; // cells per row (the board is BOARD_W × BOARD_W)
export const BOARD_CELLS = BOARD_W * BOARD_W; // total cells per layer
export const rowOf = (i: number): number => (i / BOARD_W) | 0;
export const colOf = (i: number): number => i % BOARD_W;

export interface Block {
  name: string;
  price: number;
  pool?: number[];
  water?: boolean;
  /** Absent means buyable. Grass is the exception: it is grown by watering dirt, not bought. */
  buyable?: boolean;
}
/**
 * Every block, once. `grass` is here though unbuyable (made by watering dirt) because its name and
 * value are needed anyway — they once lived in two OTHER tables (BLOCK_VALUE, an inline map in
 * sprites.ts) that had to agree. `buyable: false`, not absence, is what keeps it out of the shop.
 */
export const BLOCKS: Record<string, Block> = {
  dirt: { name: 'Dirt', price: 14, pool: DIRT_V },
  grass: { name: 'Grass', price: 18, pool: GRASS_V, buyable: false },
  rock: { name: 'Rock', price: 20, pool: ROCK_V },
  spire: { name: 'Spire', price: 22, pool: SPIRE_V },
  water: { name: 'Water', price: 18, water: true },
};
export const WATER_COST = 4; // watering dirt -> grass

const GRASS_ONLY = ['grass'];
const ROCKABLE = ['grass', 'dirt', 'rock'];
const GROUNDY = ['grass', 'dirt'];

export interface Feature {
  id: string;
  sec: string;
  name: string;
  price: number;
  on: string[];
  t?: number;
  cover?: boolean;
  pack?: number;
  cat?: string;
  file?: string;
  w?: number;
  h?: number;
  tree?: number;
  ttype?: string;
  color?: string;
  tfw?: number;
  tfh?: number;
  tn?: number;
}
export const FEATURES: Feature[] = [
  { id: 'bush_a', sec: 'Bushes', name: 'Bush', price: 12, on: GRASS_ONLY, t: 29, cover: true },
  { id: 'bush_b', sec: 'Bushes', name: 'Shrub', price: 12, on: GRASS_ONLY, t: 31, cover: true },
  { id: 'bush_c', sec: 'Bushes', name: 'Hedge', price: 14, on: GRASS_ONLY, t: 33, cover: true },
  { id: 'bush_d', sec: 'Bushes', name: 'Leafy bush', price: 14, on: GRASS_ONLY, t: 36, cover: true },
  { id: 'reed', sec: 'Flowers', name: 'Reeds', price: 10, on: GRASS_ONLY, t: 45 },
  { id: 'fl_org', sec: 'Flowers', name: 'Orange flowers', price: 18, on: GRASS_ONLY, t: 41 },
  { id: 'fl_mix', sec: 'Flowers', name: 'Wildflowers', price: 18, on: GRASS_ONLY, t: 43 },
  { id: 'fl_pur', sec: 'Flowers', name: 'Purple flowers', price: 20, on: GRASS_ONLY, t: 44 },
  { id: 'fl_red', sec: 'Flowers', name: 'Red blooms', price: 20, on: GRASS_ONLY, t: 46 },
  {
    id: 'rk1',
    sec: 'Rocks',
    name: 'Mossy rocks',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_MOSSY_1.png',
    w: 62,
    h: 34,
  },
  {
    id: 'rk2',
    sec: 'Rocks',
    name: 'Mossy pile',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_MOSSY_5.png',
    w: 52,
    h: 30,
  },
  {
    id: 'rk3',
    sec: 'Rocks',
    name: 'Mossy stones',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_MOSSY_9.png',
    w: 50,
    h: 29,
  },
  {
    id: 'rk4',
    sec: 'Rocks',
    name: 'Grey rocks',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_SILVER_1.png',
    w: 62,
    h: 34,
  },
  {
    id: 'rk5',
    sec: 'Rocks',
    name: 'Grey pile',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_SILVER_5.png',
    w: 52,
    h: 30,
  },
  {
    id: 'rk6',
    sec: 'Rocks',
    name: 'Grey stones',
    price: 6,
    on: ROCKABLE,
    pack: 1,
    cat: 'rock',
    file: 'rock_SILVER_9.png',
    w: 50,
    h: 29,
  },
  { id: 'crag', sec: 'Rocks', name: 'Crag', price: 6, on: ROCKABLE, t: 60 },
  { id: 'log', sec: 'Wood', name: 'Log', price: 4, on: GROUNDY, t: 48 },
  { id: 'log_m', sec: 'Wood', name: 'Mossy log', price: 4, on: GROUNDY, t: 50 },
  { id: 'stump', sec: 'Wood', name: 'Stump', price: 4, on: GROUNDY, t: 52 },
];
// Trees: animated (swaying) spritesheets — two shapes per colour.
const TREE_TYPES = [
  { t: 'pine', name: 'Pine', fw: 53, fh: 96, n: 16, price: 28 },
  { t: 'spruce', name: 'Spruce', fw: 74, fh: 128, n: 25, price: 36 },
];
// 6 colours (per the tree pack). The shop shows one button per colour; placing a tree picks a
// random tree TYPE of that colour (see interact.ts).
export const TREE_COLORS: [string, string][] = [
  ['GREEN', 'green'],
  ['GREEN_TEAL', 'teal-green'],
  ['TEAL', 'teal'],
  ['COLD', 'frost'],
  ['YELLOW', 'autumn'],
  ['NIGHT', 'night'],
];
export const TREE_TYPE_IDS = ['pine', 'spruce']; // available tree types to randomize over
export const TREE_PRICE = 32;
TREE_COLORS.forEach((cc) =>
  TREE_TYPES.forEach((tt) =>
    FEATURES.push({
      id: `tr_${tt.t}_${cc[0]}`,
      sec: 'Trees',
      name: `${tt.name} (${cc[1]})`,
      price: tt.price,
      on: GROUNDY,
      tree: 1,
      ttype: tt.t,
      color: cc[0],
      tfw: tt.fw,
      tfh: tt.fh,
      tn: tt.n,
    }),
  ),
);
export const FEAT_BY_ID: Record<string, Feature> = {};
FEATURES.forEach((f) => (FEAT_BY_ID[f.id] = f));

export interface Animal {
  id: string;
  name: string;
  fw: number;
  fh: number;
  n: number;
  price: number;
  flip?: boolean;
  // Frame-0 content bounding box (non-transparent pixels) within the fw×fh frame. The shop
  // thumbnail fits THIS to the cell, so animals read at a consistent size regardless of how
  // much transparent padding their strip carries (e.g. the wolf sits in a wide 64px frame).
  cx: number;
  cy: number;
  cw: number;
  ch: number;
}
export const ANIMALS: Animal[] = [
  // Badger fits its FULL frame (cx/cy=0, cw/ch=frame) so the shop thumbnail uses frame-fit — its
  // original size — rather than blowing the small content box up like the content-fit others.
  { id: 'badger', name: 'Badger', fw: 42, fh: 17, n: 22, price: 150, cx: 0, cy: 0, cw: 42, ch: 17 },
  { id: 'boar', name: 'Boar', fw: 46, fh: 24, n: 7, price: 250, cx: 4, cy: 0, cw: 37, ch: 24 },
  { id: 'stag', name: 'Stag', fw: 32, fh: 35, n: 24, price: 400, cx: 3, cy: 0, cw: 25, ch: 35 },
  { id: 'wolf', name: 'Wolf', fw: 64, fh: 28, n: 4, price: 700, cx: 19, cy: 0, cw: 26, ch: 28 },
];

// Tool sprite icons (pixel art), used for the palette icon AND the hover cursor at the same size.
export const TOOL_IMG: Record<string, string> = {
  water: `${ASSET}tools/watering_can.png`,
  dig: `${ASSET}tools/shovel.png`,
  rotate: `${ASSET}tools/wrench.png`,
};

// Backgrounds & effects: a one-time unlock (owned across all gardens), then a small cost each time
// you apply one — which also raises the achievement score (see DECOR_VALUE below).
export const BG_PRICE = 1000; // one-time unlock
export const APPLY_COST = 200; // cost to apply an owned background/effect
export const BG_URL = (id: string): string => `${ASSET}backgrounds/${id}.png`;

// ---- Economy tunables ----
// The remaining garden-value/cost numbers, gathered next to the shop prices so the economy reads in
// one place (economy.ts imports these rather than open-coding them).
export const DECOR_VALUE = 200; // 🏆 each applied background/effect adds to a garden's value
export const NEW_GARDEN_COST = 3000; // coins to buy an unlocked garden slot
export const GARDEN_STEP = 1500; // total-value increment that unlocks each new garden slot
export const COMBO_STEP = 0.5; // combo multiplier gained per streak step
export const COMBO_CAP = 5; // combo multiplier ceiling (reached at combo 9)
export const REWARD_DEFAULT = 6; // payout for a mode with no explicit REWARD_BASE entry

// Purchasable falling-particle effects (same price as a background). Sweep NE → SW.
export const FX_URL = (id: string): string => `${ASSET}fx/${id}.png`;
export interface Effect {
  id: string;
  name: string;
  fw: number; // frame width in the strip
  fh: number;
  n: number; // frame count
  dur: number; // per-particle spin duration (s)
}
export const EFFECTS: Effect[] = [
  { id: 'leaf', name: 'Leaves', fw: 12, fh: 7, n: 6, dur: 1.1 },
  { id: 'leafpink', name: 'Pink Petals', fw: 12, fh: 7, n: 6, dur: 1.1 },
  { id: 'snow', name: 'Snow', fw: 8, fh: 8, n: 7, dur: 1.4 },
  { id: 'rain', name: 'Rain', fw: 8, fh: 8, n: 3, dur: 0.4 },
];
export interface Background {
  id: string;
  name: string;
}
export const BACKGROUNDS: Background[] = [
  { id: 'nature_2', name: 'Open Meadow' },
  { id: 'nature_3', name: 'Mountain Range' },
  { id: 'nature_4', name: 'Forest Edge' },
  { id: 'nature_6', name: 'Aurora Night' },
  { id: 'nature_7', name: 'Standing Stones' },
  { id: 'nature_8', name: 'Coastal Cliffs' },
];
export const ANIM_BY_ID: Record<string, Animal> = {};
ANIMALS.forEach((a) => (ANIM_BY_ID[a.id] = a));

// Coins for a correct card, by mode. `fb` is absent on purpose (self-graded — paying it would pay the
// honour system). Every machine-graded mode must appear: `iv` was once missing, so inverse-recall paid
// nothing and didn't advance the combo; `dm` borrowed `ma`'s entry, reading as a typo not a decision.
export const REWARD_BASE: Record<string, number> = {
  bf: 20,
  cz: 24,
  iv: 24,
  ma: 40,
  ms: 34,
  dm: 40,
  cw: 22,
  cs: 40,
};
/** What a placed block is worth. Derived — a block's value IS its price; it was a second hand-kept
    table that had to be edited in lockstep with BLOCKS, and nothing made you. */
export const BLOCK_VALUE: Record<string, number> = Object.fromEntries(
  Object.entries(BLOCKS).map(([id, b]) => [id, b.price]),
);

// Isometric placement: 80px tiles, 40x20 diamond step, drawn back-to-front (z = col+row).
export const ISO_W = 80,
  ISO_HX = 40,
  ISO_HY = 20,
  ISO_OX = (BOARD_W - 1) * ISO_HX;

/**
 * The board's pixel WIDTH — derived, not restated where needed. cellPos() puts a cell at
 * x = (c-r)*ISO_HX + ISO_OX; c-r spans -(BOARD_W-1)..+(BOARD_W-1), ISO_OX slides that to start at 0,
 * so the span is (BOARD_W-1)*2*ISO_HX + one tile = 800. That 800 was hardcoded in game.css and ISO_OX
 * written as `9 * ISO_HX` (9 = BOARD_W-1). The garden's fit now divides by the same number the
 * projection is drawn with, so changing BOARD_W moves both together.
 */
export const BOARD_PX_W = (BOARD_W - 1) * 2 * ISO_HX + ISO_W;

// ---- Elevation layers ----
// Layer 0 is the ground; each layer above is lifted one cube body (ISO_LIFT = the 20px front face) so
// it stacks flush with no floating gap. Adding a layer is just bumping LAYERS — data model, rendering,
// and placement all read it.
export const ISO_LIFT = ISO_HY;
export const LAYERS = 3; // ground + two elevation layers
// Depth sorts by grid footprint first, layer only as tiebreak: z = Z_STEP*(col+row) + layer. Sorting
// by footprint (not layer) lets a tall tree sit BEHIND an elevated tile in front of it and IN FRONT OF
// one behind, with no per-object hoisting. Z_STEP leaves room for every layer between two footprint steps.
export const Z_STEP = LAYERS;

/**
 * Can an elevated tile stand on the cell directly below? Only over solid, unoccupied support: a tile
 * must exist there, and it cannot bridge water or a spire (the platform would float on nothing it can
 * key into). Anything STANDING on the cell — feature or animal — refuses it too: the object would be
 * buried, the one adjacency the footprint depth-sort cannot draw. Layer N keys onto layer N-1.
 * (Animals were once missed here, letting a deer get buried while trees/flowers were correctly blocked.)
 */
export function supportsUpper(below: GardenCell | null): boolean {
  return !!below && below.block !== 'water' && below.block !== 'spire' && !below.feature && !below.animal;
}

export interface GardenCell {
  block: string;
  v: number;
  feature?: string | null;
  animal?: string | null;
  adir?: number;
}
export function newBoard(): (GardenCell | null)[] {
  const cells: (GardenCell | null)[] = Array(BOARD_CELLS).fill(null); // row-major
  for (let r = 2; r < 7; r++)
    for (let c = 2; c < 7; c++) cells[r * BOARD_W + c] = { block: 'dirt', v: pick(DIRT_V) }; // centre 5x5 of dirt
  return cells;
}

// Board geometry. These live next to WATER_MAP because they produce the key into it.

/** Land = a non-water block. Water, empty and off-board are all "not land", so they grow no rim. */
export function isLand(cell: GardenCell | null): boolean {
  return !!(cell && cell.block !== 'water');
}

/**
 * The autotile key (index into WATER_MAP) for the water cell at `i`: one bit per land-facing edge.
 * NE=1 (r-1,c) · NW=2 (r,c-1) · SE=4 (r,c+1) · SW=8 (r+1,c). Computed here only — it was once also in
 * the debug tile-id overlay, which could then disagree with the tile it labelled.
 */
export function waterMask(cells: (GardenCell | null)[], i: number): number {
  const r = rowOf(i);
  const c = colOf(i);
  let m = 0;
  if (r > 0 && isLand(cells[(r - 1) * BOARD_W + c])) m |= 1; // NE
  if (c > 0 && isLand(cells[r * BOARD_W + c - 1])) m |= 2; // NW
  if (c < BOARD_W - 1 && isLand(cells[r * BOARD_W + c + 1])) m |= 4; // SE
  if (r < BOARD_W - 1 && isLand(cells[(r + 1) * BOARD_W + c])) m |= 8; // SW
  return m;
}
