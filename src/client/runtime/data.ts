// Boot-time card data, filled in place from /api/cards.json so every reference stays a bare
// name (CARDS, CATS, …) exactly as in the original single-file game.
import type { GameCard, CardsPayload } from '../../shared/card-schema.js';

export const app = document.getElementById('app') as HTMLElement;
export const K = 'flashcards_v2';

export const CARDS: GameCard[] = [];
export const CATS: Record<string, string> = {};
export const CATCOL: Record<string, string> = {};
export const byId: Record<string, GameCard> = {};
export const MULTIPOOL: Record<string, string[]> = {};
export const DIAGRAMS: Record<string, string> = {};

/** Populate the module-level data holders from the fetched payload (called once at boot). */
export function initData(p: CardsPayload): void {
  CARDS.length = 0;
  CARDS.push(...p.cards);
  Object.assign(CATS, p.cats);
  Object.assign(CATCOL, p.catColors);
  Object.assign(MULTIPOOL, p.multiPool);
  Object.assign(DIAGRAMS, p.diagrams);
  for (const c of p.cards) byId[c.id] = c;
}
