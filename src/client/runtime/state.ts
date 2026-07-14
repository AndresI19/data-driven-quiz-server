// The mutable game runtime, centralized in one object so modules can share it without
// fighting ES-module live-binding rules. Render functions do `const ses = S.ses!` at the top,
// keeping their bodies verbatim while writes to primitives go through `S.` .

export interface QItem {
  id: string;
  d: string; // direction/mode: fb|bf|cz|ma|ms|iv|dm (or 'mixed' pre-resolution)
}

export interface Session {
  label: string;
  deckId: string | null;
  q: QItem[];
  i: number;
  correct: number;
  missed: string[];
  elapsedMs: number;
  notes: Record<string, string>;
  timeSpeed: number;
  answered?: boolean;
  _onTimeout?: (() => void) | null;
  _final?: boolean;
  coins?: number;
  setBonus?: number;
  retryMissed?: string[];
}

export type Scope = 'all' | 'fav' | string[];
export interface Cfg {
  direction: string;
  scope: Scope;
  count: number;
  weak: boolean;
}

export interface Brush {
  type: string; // 'tool' | 'block' | 'feature' | 'animal'
  id: string;
}

export const S = {
  cfg: { direction: 'mixed', scope: 'all', count: 20, weak: false } as Cfg,
  ses: null as Session | null,
  keyHandler: null as ((e: KeyboardEvent) => void) | null,
  ticker: null as ReturnType<typeof setInterval> | null,
  cardStart: 0,
  answeredAt: 0,
  curLimit: 0,
  pausedAt: 0,
  pausedKey: null as ((e: KeyboardEvent) => void) | null,
  running: false,
  pausedFocus: null as Element | null,
  selBrush: null as Brush | null,
  layer: 0, // active editing layer: 0 = ground, 1 = elevation. Reset to ground on entering the garden.
  warnTimer: null as ReturnType<typeof setTimeout> | null,
  splashTimer: null as ReturnType<typeof setInterval> | null,
  showTileIds: false, // debug: overlay each garden tile's sprite index + water autotile bitmask
};
