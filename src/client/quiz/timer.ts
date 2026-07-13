// Timers: session total + per-card, with an optional per-card timeout that fires ses._onTimeout.
// Ported verbatim (module globals now live on S).
import { app } from '../runtime/data.js';
import { S } from '../runtime/state.js';
import { fmtClock } from '../runtime/util.js';
import type { GameCard } from '../../shared/card-schema.js';

export function baseSeconds(c: GameCard, mode: string): number {
  // content-aware base time: longer cards get more seconds. cps = chars/sec budget per mode.
  if (mode === 'ma') {
    const n = Math.min(5, (c.match || []).length || 4);
    return Math.max(20, n * 8);
  }
  if (mode === 'dm') {
    const n = c.manifest && c.manifest.blanks ? c.manifest.blanks.length : 4;
    return Math.max(24, n * 9);
  }
  if (mode === 'ms') {
    return 30;
  }
  if (mode === 'iv') {
    return 18;
  }
  let chars: number;
  if (mode === 'cz' && c.cloze) {
    chars = c.cloze.pre.length + c.cloze.post.length + c.cloze.answer.length;
  } else {
    chars = c.chars || 200;
  }
  const cps = mode === 'fb' ? 11 : mode === 'cz' ? 8 : 22;
  return Math.max(6, chars / cps);
}
export function answeredNow(): void {
  S.ses!.answered = true;
  S.answeredAt = Date.now();
}
export function stopTicker(): void {
  if (S.ticker) {
    clearInterval(S.ticker);
    S.ticker = null;
  }
  unbind();
}
export function startTicker(): void {
  stopTicker();
  S.cardStart = Date.now();
  S.answeredAt = 0;
  tick();
  S.ticker = setInterval(tick, 250);
}
/**
 * The clock's view. tick() runs four times a second for the whole quiz and used to re-query all five
 * of these every time — twenty DOM lookups a second for elements that only change when the card does.
 *
 * The cache has to be LAZY, not eager: startTicker() is called from renderQ *before* the mode draws
 * and before decorateCard adds the .tbar, so binding at start time would capture the previous card's
 * nodes. Instead each ref is re-resolved only when the one we hold has left the document — which
 * happens exactly once per card, when the mode replaces app.innerHTML.
 */
let stime: Element | null = null;
let ctime: Element | null = null;
let bar: Element | null = null;
let fill: HTMLElement | null = null;
let barText: Element | null = null;

const stale = (el: Element | null): boolean => el === null || !el.isConnected;

/** Drop the cache. Called when a card ends, so the next card cannot inherit its predecessor's nodes. */
function unbind(): void {
  stime = ctime = bar = null;
  fill = barText = null;
}

export function tick(): void {
  const ses = S.ses;
  if (!ses) {
    stopTicker();
    return;
  }
  const now = Date.now();

  if (stale(stime)) stime = app.querySelector('#stime');
  if (stime) stime.textContent = fmtClock(ses.elapsedMs + (now - S.cardStart));

  if (stale(ctime)) ctime = app.querySelector('#ctime');
  const held = (S.answeredAt || now) - S.cardStart;
  if (ctime) ctime.textContent = Math.floor(held / 1000) + 's';

  if (S.curLimit > 0) {
    const remS = Math.max(0, S.curLimit - (now - S.cardStart) / 1000);
    // The bar is appended by decorateCard, which runs after the first tick — so it legitimately
    // starts absent and appears a moment later. Re-resolving while stale covers both cases.
    if (stale(bar)) {
      bar = app.querySelector('.tbar');
      fill = bar ? (bar.querySelector('i') as HTMLElement | null) : null;
      barText = bar ? bar.querySelector('.tbar-t') : null;
    }
    if (bar) {
      if (!ses.answered) {
        const frac = Math.max(0, remS / S.curLimit);
        if (fill) fill.style.width = frac * 100 + '%';
        if (barText) barText.textContent = Math.ceil(remS) + 's';
        bar.classList.toggle('low', frac <= 0.25);
      } else {
        bar.classList.add('done');
      }
    }
    if (!ses.answered && now - S.cardStart >= S.curLimit * 1000) {
      const f = ses._onTimeout;
      ses._onTimeout = null;
      if (f) f();
    }
  }
}
export function resumeTicking(): void {
  stopTicker();
  tick();
  S.ticker = setInterval(tick, 250);
}
