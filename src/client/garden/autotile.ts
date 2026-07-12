// Directional water autotile: water picks a rim variant per land-facing edge; a spire shows its
// water base (tile 72) when both front edges (SW & SE) are water or blank. Ported verbatim.
import { DB } from '../runtime/db.js';
import { WATER_MAP } from './catalog.js';
import { isLand } from './sprites.js';

export function recomputeAutotile(): void {
  const C = DB.garden.cells;
  for (let i = 0; i < 100; i++) {
    const cell = C[i];
    if (!cell) continue;
    const r = (i / 10) | 0,
      c = i % 10;
    const NE = r > 0 ? C[(r - 1) * 10 + c] : null,
      NW = c > 0 ? C[r * 10 + c - 1] : null,
      SE = c < 9 ? C[r * 10 + c + 1] : null,
      SW = r < 9 ? C[(r + 1) * 10 + c] : null;
    if (cell.block === 'water') {
      let m = 0;
      if (isLand(NE)) m |= 1;
      if (isLand(NW)) m |= 2;
      if (isLand(SE)) m |= 4;
      if (isLand(SW)) m |= 8;
      cell.v = WATER_MAP[m] !== undefined ? WATER_MAP[m] : 113; // undefined combos -> full rim
    } else if (cell.block === 'spire') {
      cell.v = !isLand(SW) && !isLand(SE) ? 72 : 64;
    }
  }
}
