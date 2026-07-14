// Garden catalog: sprite/tileset metadata and shop data, ported verbatim (same numbers) from
// the original generator. Pure data + a couple of pure helpers — no game state.
import { pick } from '../runtime/util.js';

// ---- Sprite garden: assets under <base>assets/ (public/assets → served at <base>assets/) ----
// import.meta.env.BASE_URL is the URL prefix Vite baked in (trailing-slashed; '/' at root), so
// asset URLs resolve correctly whether the app is at '/' or behind a proxy at '/cloud-developer-quiz/'.
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

export interface Block {
  name: string;
  price: number;
  pool?: number[];
  water?: boolean;
  /** Absent means buyable. Grass is the exception: it is grown by watering dirt, not bought. */
  buyable?: boolean;
}
/**
 * Every block, once.
 *
 * `grass` is here even though it cannot be bought — it is made by watering dirt (WATER_COST). It has
 * to be in the table anyway, because its name and its value are needed all the same: they used to be
 * kept in two OTHER places (a `BLOCK_VALUE` map and an inline name map in sprites.ts), which is three
 * tables that had to agree about four blocks and silently didn't have to about the fifth.
 *
 * `buyable: false` is what keeps it out of the shop, rather than its absence from the table.
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
export const FEAT_SECS = ['Bushes', 'Flowers', 'Trees', 'Rocks', 'Wood'];
export const FEAT_DROP = 0.18; // tileset object features shift down this fraction of a tile

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
// you apply one — which also raises the achievement score (see economy.DECOR_VALUE).
export const BG_PRICE = 1000; // one-time unlock
export const APPLY_COST = 200; // cost to apply an owned background/effect
export const BG_URL = (id: string): string => `${ASSET}backgrounds/${id}.png`;

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

// Coins for a correct card, by mode. `fb` is absent on purpose — it is self-graded, so paying for it
// would pay the honour system. Every machine-graded mode must appear here: `iv` was missing, so a
// correct inverse-recall card silently paid nothing and did not advance the combo, and `dm` used to
// borrow `ma`'s entry (same value, but it read as a typo rather than a decision).
export const REWARD_BASE: Record<string, number> = { bf: 20, cz: 24, iv: 24, ma: 40, ms: 34, dm: 40 };
/** What a placed block is worth. Derived — a block's value IS its price; it was a second hand-kept
    table that had to be edited in lockstep with BLOCKS, and nothing made you. */
export const BLOCK_VALUE: Record<string, number> = Object.fromEntries(
  Object.entries(BLOCKS).map(([id, b]) => [id, b.price]),
);

// Isometric placement: 80px tiles, 40x20 diamond step, drawn back-to-front (z = col+row).
export const ISO_W = 80,
  ISO_HX = 40,
  ISO_HY = 20,
  ISO_OX = 9 * ISO_HX;

// ---- Elevation layers ----
// The board has stacked editing layers. Layer 0 is the ground; layer 1 is an elevation plane lifted
// exactly one cube body (ISO_LIFT === the cube's 20px front face), so an elevated tile stacks flush
// on the ground tile with no floating gap — see catalog tiles, whose body is 8px of a 32px sprite.
export const ISO_LIFT = ISO_HY;
export const LAYERS = 2; // ground + one elevation layer (this pass)
// Depth is sorted by grid footprint first, layer only as a tiebreak: z = Z_STEP*(col+row) + layer.
// Sorting by footprint (not by layer) is what lets a tall tree correctly sit BEHIND an elevated tile
// in front of it and IN FRONT OF one behind it, with no per-object hoisting. Z_STEP just leaves room
// for the layer to slot between two footprint steps.
export const Z_STEP = LAYERS;

/**
 * Can an elevated tile stand on this ground cell? Only over solid, unoccupied ground: there must BE a
 * tile beneath it, and it cannot bridge water or a spire (both would leave the platform floating on a
 * surface nothing can key into). An occupied ground cell (a tree/bush under it) is refused too — the
 * one adjacency the footprint depth-sort genuinely cannot draw, since the object would spear up
 * through the platform. `dig it first` is the fix, not a render trick.
 */
export function supportsUpper(ground: GardenCell | null): boolean {
  return !!ground && ground.block !== 'water' && ground.block !== 'spire' && !ground.feature;
}

export interface GardenCell {
  block: string;
  v: number;
  feature?: string | null;
  animal?: string | null;
  adir?: number;
}
export function newBoard(): (GardenCell | null)[] {
  const cells: (GardenCell | null)[] = Array(100).fill(null); // 10x10 row-major
  for (let r = 2; r < 7; r++)
    for (let c = 2; c < 7; c++) cells[r * 10 + c] = { block: 'dirt', v: pick(DIRT_V) }; // centre 5x5 of dirt
  return cells;
}

// ---------------------------------------------------------------------------------------------
// Board geometry. These live next to WATER_MAP because they are what produces the key into it.
// ---------------------------------------------------------------------------------------------

/** Land = a non-water block. Water, empty and off-board are all "not land", so they grow no rim. */
export function isLand(cell: GardenCell | null): boolean {
  return !!(cell && cell.block !== 'water');
}

/**
 * The autotile key for the water cell at `i`: one bit per land-facing edge.
 * NE=1 (r-1,c) · NW=2 (r,c-1) · SE=4 (r,c+1) · SW=8 (r+1,c).
 *
 * This is the index into WATER_MAP, and it used to be computed in two places — the autotiler and
 * the debug tile-id overlay — which meant the overlay could disagree with the tile it was labelling.
 * That is the one thing an overlay exists not to do.
 */
export function waterMask(cells: (GardenCell | null)[], i: number): number {
  const r = (i / 10) | 0;
  const c = i % 10;
  let m = 0;
  if (r > 0 && isLand(cells[(r - 1) * 10 + c])) m |= 1; // NE
  if (c > 0 && isLand(cells[r * 10 + c - 1])) m |= 2; // NW
  if (c < 9 && isLand(cells[r * 10 + c + 1])) m |= 4; // SE
  if (r < 9 && isLand(cells[(r + 1) * 10 + c])) m |= 8; // SW
  return m;
}
