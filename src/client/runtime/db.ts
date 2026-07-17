import { BOARD_CELLS, type GardenCell, LAYERS, newBoard } from '../garden/catalog.js';
// Persistent store (localStorage key 'flashcards_v2'): per-card stats, the in-progress session, saved
// sessions, favorites, flags, settings, and the garden. The init + migration block runs once at import.
import { K } from './data.js';
import type { QItem } from './state.js';

// A garden board. Wallet/unlocks are shared (on DBShape), so a Garden only holds its own tiles,
// its foreground-hidden view flag, and its selected background.
export interface Garden {
  cells: (GardenCell | null)[]; // ground layer (layer 0)
  upper: (GardenCell | null)[][]; // elevation layers 1..LAYERS-1, ground-up; each sparse (mostly null)
  hideFg: boolean;
  bg: string | null; // selected background id, or null
  fx: string | null; // selected particle effect id, or null
}
/** A fresh garden. Lives here rather than in the catalog because the catalog cannot see this type —
    db.ts imports the catalog, not the other way round. Was an object literal written out twice. */
export function newGarden(): Garden {
  return { cells: newBoard(), upper: emptyElevation(), hideFg: false, bg: null, fx: null };
}
/** A blank layer. Elevation layers start empty — you build up onto them. */
export function emptyLayer(): (GardenCell | null)[] {
  return Array(BOARD_CELLS).fill(null);
}
/** A fresh set of empty elevation layers (one per layer above the ground). */
export function emptyElevation(): (GardenCell | null)[][] {
  return Array.from({ length: LAYERS - 1 }, emptyLayer);
}
/** The cell array for a given layer: 0 is the ground, ≥1 index into the elevation-layer list. */
export function layerCells(g: Garden, layer: number): (GardenCell | null)[] {
  return layer === 0 ? g.cells : g.upper[layer - 1];
}
export interface SessionRec {
  id: string;
  label: string;
  at: string;
  total: number;
  correct: number;
  wrong: number;
  missedIds: string[];
  notes: Record<string, string>;
  noteCount: number;
  elapsedMs: number;
  timeSpeed: number;
}
export interface ActiveSnap {
  label: string;
  q: QItem[];
  i: number;
  correct: number;
  missed: string[];
  elapsedMs: number;
  notes: Record<string, string>;
  timeSpeed: number;
}
export interface Settings {
  volume: number;
  muted: boolean;
  timeSpeed: number;
  hints: boolean;
}
/** A one-time coin award: 'none' before it is earned, 'pending' once earned but unclaimed (the garden
    mail marker shows), 'claimed' after the player collects it. Lives on the synced document so a claim
    on one browser suppresses the marker on every other. */
export type GrantState = 'none' | 'pending' | 'claimed';

export interface DBShape {
  stats: Record<string, { seen: number; missed: number }>;
  active: ActiveSnap | null;
  sessions: SessionRec[];
  favorites: Record<string, boolean>;
  flags: Record<string, boolean>;
  // Shared garden wallet + unlocks (across all gardens).
  coins: number;
  combo: number;
  infinite: boolean;
  spent: number;
  maxScore: number; // highest garden value ever reached — gates buying new gardens
  ownedBg: Record<string, boolean>; // purchased background ids
  ownedFx: Record<string, boolean>; // purchased effect ids
  gardens: Garden[];
  gardenIdx: number;
  garden: Garden; // === gardens[gardenIdx], the active board
  settings: Settings;
  // Welcome coin awards, claimed via the garden mail button. `login` for having an account; `contact`
  // (deferred) for sharing a LinkedIn/company. See garden/grants.ts.
  grant: { login: GrantState; contact: GrantState };
  // Which identity owns this document — a username or 'guest'. localStorage is browser-global, so
  // without this tag one user's document (garden, coins, grant) bleeds into the next on the same
  // browser. reconcileOwner() in runtime/auth.ts resets the document when it belongs to another user.
  owner?: string;
}

export const DB: DBShape = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(K) || 'null');
    if (v) return v as DBShape;
  } catch (e) {}
  return { stats: {}, active: null } as unknown as DBShape;
})();
/**
 * Repair a document IN PLACE — backfill fields every consumer reads unconditionally, migrate legacy
 * garden shapes, drop entries too broken to keep. Idempotent. Exported (not just run at import)
 * because pull() also fills DB via `Object.assign(DB, data)` without re-running it: a synced document
 * predating a field the UI assumes (originally a session with no `missedIds`) would reach the UI
 * unrepaired. That surfaced as an "admin-only" crash — guests never pull, newer accounts already match
 * the schema. Sharing this across both paths is the fix; see the sessions block for the crash.
 */
export function repairDB(): void {
  if (!DB.stats) DB.stats = {};
  if (!DB.sessions) DB.sessions = [];
  // A session can predate fields the UI reads unconditionally, or arrive malformed from a sync. One
  // entry missing `missedIds` threw at `s.missedIds.length` mid-render — AFTER setup() had pushed
  // /home and switched the ambient background — so "quit to menu" flipped the URL but left the quiz on
  // screen, wedging navigation and the pause button. Backfill what consumers assume; drop the unfixable.
  DB.sessions = DB.sessions.filter((s) => !!s && typeof s === 'object');
  DB.sessions.forEach((s) => {
    if (!Array.isArray(s.missedIds)) s.missedIds = [];
    if (!s.notes || typeof s.notes !== 'object') s.notes = {};
    if (typeof s.noteCount !== 'number') {
      s.noteCount = Object.keys(s.notes).filter((k) => (s.notes[k] || '').trim()).length;
    }
  });
  // A resume snapshot with no question list would throw the same way in the home resume banner.
  if (DB.active && !Array.isArray(DB.active.q)) DB.active = null;
  if (!DB.favorites) DB.favorites = {};
  if (!DB.flags) DB.flags = {};
  // Welcome-coin grant ledger. A legacy or freshly-created document has none; default every slot to
  // 'none' so garden/grants.ts can promote 'none'→'pending' when the award is earned.
  if (!DB.grant || typeof DB.grant !== 'object') DB.grant = { login: 'none', contact: 'none' };
  if (DB.grant.login == null) DB.grant.login = 'none';
  if (DB.grant.contact == null) DB.grant.contact = 'none';
  // Garden(s): shared wallet on DB, each garden holds only cells/hideFg/bg. Migrate a legacy single
  // garden (wallet fields on DB.garden) up to the shared level.
  {
    const legacy = (DB.garden && typeof DB.garden === 'object' ? DB.garden : {}) as Record<string, unknown>;
    if (DB.coins == null) DB.coins = (legacy.coins as number) ?? 0;
    if (DB.combo == null) DB.combo = (legacy.combo as number) ?? 0;
    // Default OFF. Once defaulted `?? true` — a dev "god mode" that shipped on. Now an ADMIN tool:
    // enforced false for non-admins at boot (see main.ts), toggled only via the admin debug menu.
    if (DB.infinite == null) DB.infinite = (legacy.infinite as boolean) ?? false;
    if (DB.spent == null) DB.spent = (legacy.spent as number) ?? 0;
    if (DB.maxScore == null) DB.maxScore = 0;
    if (!DB.ownedBg) DB.ownedBg = {};
    if (!DB.ownedFx) DB.ownedFx = {};
    if (!Array.isArray(DB.gardens)) {
      const cells =
        DB.garden && Array.isArray(DB.garden.cells) && !(legacy.gardens as unknown)
          ? DB.garden.cells
          : newBoard();
      DB.gardens = [
        {
          cells,
          upper: emptyElevation(),
          hideFg: (legacy.hideFg as boolean) ?? false,
          bg: (legacy.bg as string) ?? null,
          fx: null,
        },
      ];
      DB.gardenIdx = 0;
    }
    if (DB.gardenIdx == null || DB.gardenIdx < 0 || DB.gardenIdx >= DB.gardens.length) DB.gardenIdx = 0;
    DB.gardens.forEach((g) => {
      if (!Array.isArray(g.cells)) g.cells = newBoard();
      // Elevation layers. Three shapes reach here: absent (pre-elevation), a single FLAT layer (the
      // first release stored `upper` as one 100-cell array), or the current array-of-layers. Wrap the
      // flat one so its content stays at layer 1, then pad up to LAYERS-1 layers.
      const up = g.upper as unknown;
      if (!Array.isArray(up)) g.upper = [];
      else if (up.length > 0 && !Array.isArray(up[0])) g.upper = [up as (GardenCell | null)[]]; // legacy single flat elevation layer → layer 1
      while (g.upper.length < LAYERS - 1) g.upper.push(emptyLayer());
      if (g.hideFg == null) g.hideFg = false;
      if (g.bg === undefined) g.bg = null;
      if (g.fx === undefined) g.fx = null;
    });
    DB.garden = DB.gardens[DB.gardenIdx];
  }
  if (!DB.settings) DB.settings = {} as Settings;
  {
    const settings = DB.settings;
    if (settings.volume == null) settings.volume = 50;
    if (settings.muted == null) settings.muted = false;
    if (settings.timeSpeed == null) settings.timeSpeed = 1;
    if (settings.hints == null) settings.hints = true;
  }
}

// Repair the local document once, at import — the same pass pull() re-runs on an adopted document.
repairDB();

/**
 * Discard the document and rebuild a fresh default. Used by reconcileOwner() when the stored document
 * belongs to a different signed-in user: clearing every key and re-running repairDB() gives exactly a
 * first-time visitor's default, rather than enumerating what to null out by hand.
 */
export function resetDoc(): void {
  const bag = DB as unknown as Record<string, unknown>;
  for (const k of Object.keys(bag)) delete bag[k];
  repairDB();
}

/**
 * Notify that the document changed. There is exactly ONE write point in this app (saveDB), so sync
 * hooks here rather than being sprinkled through the garden, engine, and session recorder. A plain
 * callback, not an import, so this module knows nothing about the network.
 */
const savedHooks: Array<() => void> = [];
export function onSaved(fn: () => void): void {
  savedHooks.push(fn);
}

export function saveDB(): void {
  try {
    localStorage.setItem(K, JSON.stringify(DB));
  } catch (e) {}
  for (const fn of savedHooks) fn();
}
export function stamp(): string {
  try {
    return new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (e) {
    return '';
  }
}
