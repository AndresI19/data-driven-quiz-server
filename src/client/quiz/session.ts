import type { GameCard } from '../../shared/card-schema.js';
import { stopSplashes } from '../garden/splash.js';
import { setup } from '../pages/home.js';
// Session lifecycle + persistence: begin/resume/retry/advance/finalize and the start-from-setup
// entry points. Ported verbatim.
import { CARDS, app, byId } from '../runtime/data.js';
import { type ActiveSnap, DB, saveDB, stamp } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { shuffle } from '../runtime/util.js';
import { renderQ } from './engine.js';
import { rate } from './grading.js';
import { stopTicker } from './timer.js';

interface BeginOpts {
  label?: string;
  deckId?: string | null;
  timeSpeed?: number;
  direction?: string;
}

export function persist(): void {
  const ses = S.ses;
  if (ses) {
    DB.active = {
      label: ses.label,
      deckId: ses.deckId,
      q: ses.q,
      i: ses.i,
      correct: ses.correct,
      missed: ses.missed,
      elapsedMs: ses.elapsedMs,
      notes: ses.notes,
      timeSpeed: ses.timeSpeed,
    };
    if (ses.deckId) {
      const dk = DB.decks.find((d) => d.id === ses.deckId);
      if (dk)
        dk.progress = {
          label: ses.label,
          deckId: ses.deckId,
          q: ses.q,
          i: ses.i,
          correct: ses.correct,
          missed: ses.missed,
          elapsedMs: ses.elapsedMs,
          notes: ses.notes,
          timeSpeed: ses.timeSpeed,
        };
    }
  }
  saveDB();
}
export function pickDir(dir: string, c: GameCard): string {
  if (c.recall) return 'fb';
  if (dir === 'mixed') {
    const m = ['fb', 'bf'];
    if (c.cloze) m.push('cz');
    if (c.match) m.push('ma');
    if (c.multi) m.push('ms');
    if (c.inverse) m.push('iv');
    if (c.manifest) m.push('dm');
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
    deckId: opts.deckId || null,
    q,
    i: 0,
    correct: 0,
    missed: [],
    elapsedMs: 0,
    notes: {},
    timeSpeed: opts.timeSpeed != null ? opts.timeSpeed : DB.settings.timeSpeed,
  };
  persist();
  renderQ();
}
export function resumeSnap(snap: ActiveSnap, deckId?: string | null): void {
  S.ses = {
    label: snap.label || 'Session',
    deckId: (deckId !== undefined ? deckId : snap.deckId) || null,
    q: snap.q,
    i: snap.i,
    correct: snap.correct,
    missed: snap.missed,
    elapsedMs: snap.elapsedMs || 0,
    notes: snap.notes || {},
    timeSpeed: snap.timeSpeed != null ? snap.timeSpeed : DB.settings.timeSpeed,
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
      timeSpeed: speed != null ? speed : s.timeSpeed != null ? s.timeSpeed : DB.settings.timeSpeed,
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
  if (DB.sessions.length > 50) DB.sessions.length = 50;
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
export function start(): void {
  let cards =
    S.cfg.scope === 'fav'
      ? CARDS.filter((c) => DB.favorites[c.id])
      : Array.isArray(S.cfg.scope)
        ? CARDS.filter((c) => (S.cfg.scope as string[]).includes(c.cat))
        : CARDS.slice();
  if (S.cfg.direction === 'cz') cards = cards.filter((c) => c.cloze);
  else if (S.cfg.direction === 'ma') cards = cards.filter((c) => c.match);
  else if (S.cfg.direction === 'ms') cards = cards.filter((c) => c.multi);
  else if (S.cfg.direction === 'iv') cards = cards.filter((c) => c.inverse);
  else if (S.cfg.direction === 'dm') cards = cards.filter((c) => c.manifest);
  cards = S.cfg.weak ? cards.slice().sort((a, b) => rate(b) - rate(a)) : shuffle(cards);
  if (S.cfg.count) cards = cards.slice(0, S.cfg.count);
  if (!cards.length) {
    app.innerHTML = `<div class="wrap"><div class="panel"><div class="scoreline" style="margin:0 0 16px">No cards match that mode + section. Try Mixed or All sections.</div><div class="actions center"><button class="btn primary" id="back">Back</button></div></div></div>`;
    app.querySelector('#back')!.addEventListener('click', setup);
    return;
  }
  const dmap: Record<string, string> = {
    fb: 'recall',
    bf: 'choice',
    cz: 'fill-in',
    ma: 'match',
    ms: 'multi',
    iv: 'inverse',
    dm: 'label the YAML',
    mixed: 'mixed',
  };
  const label = `${
    S.cfg.scope === 'all'
      ? 'All sections'
      : S.cfg.scope === 'fav'
        ? '★ Favorites'
        : `§ ${(S.cfg.scope as string[]).join(' ')}`
  } · ${dmap[S.cfg.direction]}`;
  begin(cards, { label });
}
export function startDeck(id: string): void {
  const dk = DB.decks.find((d) => d.id === id);
  if (!dk) return;
  const cards = shuffle(dk.cardIds.map((cid) => byId[cid]).filter(Boolean));
  if (cards.length) begin(cards, { label: dk.name, deckId: dk.id });
}
export function resumeDeck(id: string): void {
  const dk = DB.decks.find((d) => d.id === id);
  if (!dk) return;
  if (dk.progress) resumeSnap(dk.progress, dk.id);
  else startDeck(id);
}
export function deleteDeck(id: string): void {
  DB.decks = DB.decks.filter((d) => d.id !== id);
  if (DB.active && DB.active.deckId === id) DB.active = null;
  saveDB();
  setup();
}
export function resumeActive(): void {
  if (DB.active) resumeSnap(DB.active, DB.active.deckId);
}
export function discardActive(): void {
  const a = DB.active;
  if (a?.deckId) {
    const dk = DB.decks.find((d) => d.id === a.deckId);
    if (dk) dk.progress = null;
  }
  DB.active = null;
  saveDB();
  setup();
}
