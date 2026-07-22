import type { GameCard } from '../../shared/card-schema.js';
import { stopSplashes } from '../garden/splash.js';
import { setup } from '../pages/home.js';
// Session lifecycle + persistence: begin/resume/retry/advance/finalize and the start-from-setup
// entry points. Ported verbatim.
import { CARDS, app, byId } from '../runtime/data.js';
import { type ActiveSnap, DB, saveDB, stamp } from '../runtime/db.js';
import { S, type Scope } from '../runtime/state.js';
import { shuffle } from '../runtime/util.js';
import { availableModes, supportsMode } from './capabilities.js';
import { renderQ } from './engine.js';
import { rate } from './grading.js';
import { stopTicker } from './timer.js';

/** How many finished sessions to retain in history before the oldest are dropped. */
const MAX_SAVED_SESSIONS = 50;

interface BeginOpts {
  label?: string;
  timeSpeed?: number;
  direction?: string;
}

export function persist(): void {
  const ses = S.ses;
  if (ses) {
    DB.active = {
      label: ses.label,
      q: ses.q,
      i: ses.i,
      correct: ses.correct,
      missed: ses.missed,
      elapsedMs: ses.elapsedMs,
      notes: ses.notes,
      timeSpeed: ses.timeSpeed,
    };
  }
  saveDB();
}
export function pickDir(dir: string, c: GameCard): string {
  if (c.recall) return 'bf'; // recall-only cards fall back to identify now that fb is gone
  if (dir === 'mixed') {
    const m = availableModes(c);
    return m[Math.floor(Math.random() * m.length)];
  }
  return dir;
}
export function begin(cards: GameCard[], opts: BeginOpts): void {
  stopSplashes();
  const dir = opts.direction || S.cfg.direction;
  const q = cards.map((c) => ({ id: c.id, d: pickDir(dir, c) }));
  S.ses = {
    label: opts.label || 'Session',
    q,
    i: 0,
    correct: 0,
    missed: [],
    elapsedMs: 0,
    notes: {},
    timeSpeed: opts.timeSpeed ?? DB.settings.timeSpeed,
  };
  persist();
  renderQ();
}
export function resumeSnap(snap: ActiveSnap): void {
  S.ses = {
    label: snap.label || 'Session',
    q: snap.q,
    i: snap.i,
    correct: snap.correct,
    missed: snap.missed,
    elapsedMs: snap.elapsedMs || 0,
    notes: snap.notes || {},
    timeSpeed: snap.timeSpeed ?? DB.settings.timeSpeed,
  };
  renderQ();
}
export function retrySession(id: string, speed?: number): void {
  const s = DB.sessions.find((x) => x.id === id);
  if (!s) return;
  const cards = shuffle(s.missedIds.map((cid) => byId[cid]).filter(Boolean));
  if (cards.length)
    begin(cards, {
      label: `Retry · ${s.label}`,
      timeSpeed: speed ?? s.timeSpeed ?? DB.settings.timeSpeed,
    });
}
export function reviewIds(s: { missedIds?: string[]; notes?: Record<string, string> }): string[] {
  return Array.from(
    new Set([
      ...(s.missedIds || []),
      ...Object.keys(s.notes || {}).filter((k) => (s.notes![k] || '').trim()),
    ]),
  ).filter((id) => byId[id]);
}
export function advance(): void {
  const ses = S.ses!;
  ses.elapsedMs += Date.now() - S.cardStart;
  stopTicker();
  S.running = false;
  ses.i++;
  persist();
  renderQ();
}
export function finalize(): void {
  const ses = S.ses!;
  if (ses._final) return;
  ses._final = true;
  DB.active = null;
  const notes = ses.notes || {};
  const noteCount = Object.keys(notes).filter((k) => (notes[k] || '').trim()).length;
  const rec = {
    id: `s${Date.now()}`,
    label: ses.label || 'Session',
    at: stamp(),
    total: ses.q.length,
    correct: ses.correct,
    wrong: ses.q.length - ses.correct,
    missedIds: ses.missed.slice(),
    notes: Object.assign({}, notes),
    noteCount: noteCount,
    elapsedMs: ses.elapsedMs,
    timeSpeed: ses.timeSpeed,
  };
  DB.sessions.unshift(rec);
  if (DB.sessions.length > MAX_SAVED_SESSIONS) DB.sessions.length = MAX_SAVED_SESSIONS;
  ses.retryMissed = rec.missedIds;
  // Set-completion bonus: base per 10-card bracket is 10,20,40,80,160... summed, then x accuracy.
  const brackets = Math.floor(ses.q.length / 10);
  if (brackets > 0 && ses.q.length) {
    const base = 10 * (2 ** brackets - 1); // 10,30,70,150,310...
    const bonus = Math.round(base * (ses.correct / ses.q.length));
    if (bonus > 0) {
      DB.coins += bonus;
      ses.coins = (ses.coins || 0) + bonus;
      ses.setBonus = bonus;
    }
  }
  saveDB();
}
const DIRECTION_LABELS: Record<string, string> = {
  bf: 'choice',
  cz: 'fill-in',
  ma: 'match',
  ms: 'multi',
  iv: 'inverse',
  fl: 'fill the blanks',
  or: 'order',
  cw: 'read the code',
  cs: 'select lines',
  mixed: 'mixed',
};

/** The cards a scope selects, before mode-filtering: favourites, a set of sections, or everything. */
export function scopedCards(scope: Scope): GameCard[] {
  if (scope === 'fav') return CARDS.filter((c) => DB.favorites[c.id]);
  if (Array.isArray(scope)) return CARDS.filter((c) => scope.includes(c.cat));
  return CARDS.slice();
}

/** Human-readable name for the chosen scope, used in the session label. */
function scopeLabel(scope: Scope): string {
  if (scope === 'all') return 'All sections';
  if (scope === 'fav') return '★ Favorites';
  return `§ ${scope.join(' ')}`;
}

export function start(): void {
  let cards = scopedCards(S.cfg.scope).filter((c) => supportsMode(c, S.cfg.direction));
  cards = S.cfg.weak ? cards.slice().sort((a, b) => rate(b) - rate(a)) : shuffle(cards);
  if (S.cfg.count) cards = cards.slice(0, S.cfg.count);
  if (!cards.length) {
    app.innerHTML = `<div class="wrap"><div class="panel"><div class="scoreline" style="margin:0 0 16px">No cards match that mode + section. Try Mixed or All sections.</div><div class="actions center"><button class="btn primary" id="back">Back</button></div></div></div>`;
    app.querySelector('#back')!.addEventListener('click', setup);
    return;
  }
  const label = `${scopeLabel(S.cfg.scope)} · ${DIRECTION_LABELS[S.cfg.direction]}`;
  begin(cards, { label });
}
export function resumeActive(): void {
  if (DB.active) resumeSnap(DB.active);
}
export function discardActive(): void {
  DB.active = null;
  saveDB();
  setup();
}
