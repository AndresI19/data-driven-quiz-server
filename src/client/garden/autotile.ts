// Directional water autotile: water picks a rim variant per land-facing edge; a spire shows its
// water base (tile 72) when both front edges (SW & SE) are water or blank.
import { DB } from '../runtime/db.js';
import { type GardenCell, WATER_MAP, isLand, waterMask } from './catalog.js';

/**
 * Re-pick the tile variant of every water and spire cell on a board.
 *
 * Takes the board rather than reading DB.garden, which is the whole point: this is the only real
 * algorithm in the garden, and it was untestable purely because it reached for a global. Now it is
 * a pure function of an array — see autotile.test.ts, which table-tests all sixteen edge masks.
 */
export function autotile(cells: (GardenCell | null)[]): void {
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;

    if (cell.block === 'water') {
      const m = waterMask(cells, i);
      // An unmapped combination gets the full rim rather than a hole in the world.
      cell.v = WATER_MAP[m] !== undefined ? WATER_MAP[m] : 113;
      continue;
    }

    if (cell.block === 'spire') {
      // A spire standing over water shows its wet base — only the two FRONT edges matter, because
      // those are the ones the player can see beneath it.
      const r = (i / 10) | 0;
      const c = i % 10;
      const SE = c < 9 ? cells[r * 10 + c + 1] : null;
      const SW = r < 9 ? cells[(r + 1) * 10 + c] : null;
      cell.v = !isLand(SW) && !isLand(SE) ? 72 : 64;
    }
  }
}

/** The board-in-play. A thin shim so callers do not have to know where the garden lives. */
export function recomputeAutotile(): void {
  autotile(DB.garden.cells);
}
