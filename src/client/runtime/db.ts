// Persistent store (localStorage key 'flashcards_v2'): lifetime per-card stats, the in-progress
// session, saved retry decks, sessions, favorites, flags, settings, and the garden. The init +
// migration block runs once at import and matches the original defaults exactly.
import { K } from './data.js';
import { newBoard, type GardenCell } from '../garden/catalog.js';
import type { QItem } from './state.js';

// A garden board. Wallet/unlocks are shared (on DBShape), so a Garden only holds its own tiles,
// its foreground-hidden view flag, and its selected background.
export interface Garden {
  cells: (GardenCell | null)[];
  hideFg: boolean;
  bg: string | null; // selected background id, or null
  fx: string | null; // selected particle effect id, or null
}
/** A fresh garden. Lives here rather than in the catalog because the catalog cannot see this type —
    db.ts imports the catalog, not the other way round. Was an object literal written out twice. */
export function newGarden(): Garden {
  return { cells: newBoard(), hideFg: false, bg: null, fx: null };
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
  deckId: string | null;
  q: QItem[];
  i: number;
  correct: number;
  missed: string[];
  elapsedMs: number;
  notes: Record<string, string>;
  timeSpeed: number;
}
export interface Deck {
  id: string;
  name: string;
  cardIds: string[];
  progress?: ActiveSnap | null;
}
export interface Settings {
  volume: number;
  muted: boolean;
  timeSpeed: number;
  hints: boolean;
}
export interface DBShape {
  stats: Record<string, { seen: number; missed: number }>;
  active: ActiveSnap | null;
  decks: Deck[];
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
}

export const DB: DBShape = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(K) || 'null');
    if (v) return v as DBShape;
  } catch (e) {}
  return { stats: {}, active: null, decks: [] } as unknown as DBShape;
})();
if (!DB.stats) DB.stats = {};
if (!DB.decks) DB.decks = [];
if (!DB.sessions) DB.sessions = [];
if (!DB.favorites) DB.favorites = {};
if (!DB.flags) DB.flags = {};
// Garden(s): shared wallet lives on DB; each garden holds only cells/hideFg/bg.
// Migrate a legacy single garden (wallet fields on DB.garden) up to the shared level.
{
  const legacy = (DB.garden && typeof DB.garden === 'object' ? DB.garden : {}) as Record<string, unknown>;
  if (DB.coins == null) DB.coins = (legacy.coins as number) ?? 0;
  if (DB.combo == null) DB.combo = (legacy.combo as number) ?? 0;
  if (DB.infinite == null) DB.infinite = (legacy.infinite as boolean) ?? true;
  if (DB.spent == null) DB.spent = (legacy.spent as number) ?? 0;
  if (DB.maxScore == null) DB.maxScore = 0;
  if (!DB.ownedBg) DB.ownedBg = {};
  if (!DB.ownedFx) DB.ownedFx = {};
  if (!Array.isArray(DB.gardens)) {
    const cells =
      DB.garden && Array.isArray(DB.garden.cells) && !(legacy.gardens as unknown)
        ? DB.garden.cells
        : newBoard();
    DB.gardens = [{ cells, hideFg: (legacy.hideFg as boolean) ?? false, bg: (legacy.bg as string) ?? null, fx: null }];
    DB.gardenIdx = 0;
  }
  if (DB.gardenIdx == null || DB.gardenIdx < 0 || DB.gardenIdx >= DB.gardens.length) DB.gardenIdx = 0;
  DB.gardens.forEach((g) => {
    if (!Array.isArray(g.cells)) g.cells = newBoard();
    if (g.hideFg == null) g.hideFg = false;
    if (g.bg === undefined) g.bg = null;
    if (g.fx === undefined) g.fx = null;
  });
  DB.garden = DB.gardens[DB.gardenIdx];
}
if (!DB.settings) DB.settings = {} as Settings;
{
  const Sset = DB.settings;
  if (Sset.volume == null) Sset.volume = 50;
  if (Sset.muted == null) Sset.muted = false;
  if (Sset.timeSpeed == null) Sset.timeSpeed = 1;
  if (Sset.hints == null) Sset.hints = true;
}

export function saveDB(): void {
  try {
    localStorage.setItem(K, JSON.stringify(DB));
  } catch (e) {}
}
export function today(): string {
  try {
    return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return '';
  }
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
