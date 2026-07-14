// Occasional water splash (tiles 82-85) — each water tile roughly every ~20s, at most one at a
// time. Ported verbatim.
import { app } from '../runtime/data.js';
import { DB } from '../runtime/db.js';
import { S } from '../runtime/state.js';
import { TIMG } from './catalog.js';

export function stopSplashes(): void {
  if (S.splashTimer) {
    clearInterval(S.splashTimer);
    S.splashTimer = null;
  }
}
export function startSplashes(): void {
  stopSplashes();
  S.splashTimer = setInterval(() => {
    const C = DB.garden.cells;
    const water: number[] = [];
    for (let i = 0; i < 100; i++) {
      if (C[i] && C[i]!.block === 'water') water.push(i);
    }
    if (!water.length) return;
    if (Math.random() > Math.min(0.88, (water.length * 2.75) / 20)) return; // ~1 splash per tile / 18s (10% more than before)
    const gart = app.querySelector(`.gart[data-i="${water[Math.floor(Math.random() * water.length)]}"]`);
    if (gart && !gart.querySelector('.gsplash')) {
      const s = document.createElement('img');
      s.className = 'gsplash';
      s.src = TIMG(82);
      gart.appendChild(s);
      let f = 82;
      const iv = setInterval(() => {
        f++;
        if (f > 85) {
          clearInterval(iv);
          s.remove();
        } else s.src = TIMG(f);
      }, 160);
    }
  }, 2500);
}
