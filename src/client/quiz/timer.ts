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
}
export function startTicker(): void {
  stopTicker();
  S.cardStart = Date.now();
  S.answeredAt = 0;
  tick();
  S.ticker = setInterval(tick, 250);
}
export function tick(): void {
  const ses = S.ses;
  if (!ses) {
    stopTicker();
    return;
  }
  const now = Date.now();
  const st = app.querySelector('#stime');
  if (st) st.textContent = fmtClock(ses.elapsedMs + (now - S.cardStart));
  const held = (S.answeredAt || now) - S.cardStart;
  const ct = app.querySelector('#ctime');
  if (ct) ct.textContent = Math.floor(held / 1000) + 's';
  if (S.curLimit > 0) {
    const remS = Math.max(0, S.curLimit - (now - S.cardStart) / 1000);
    const bar = app.querySelector('.tbar');
    if (bar) {
      if (!ses.answered) {
        const frac = Math.max(0, remS / S.curLimit);
        const fill = bar.querySelector('i') as HTMLElement | null;
        if (fill) fill.style.width = frac * 100 + '%';
        const t = bar.querySelector('.tbar-t');
        if (t) t.textContent = Math.ceil(remS) + 's';
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
