import { describe, expect, test } from 'vitest';
import type { CardsPayload, GameCard } from '../shared/card-schema.js';
import { buildPrintHtml } from './build-print.js';

/**
 * Characterization tests for the duplex print sheet's BACK_ORDER interleave. Fronts print in reading
 * order [0..7]; backs print in the swapped order [1,0,3,2,5,4,7,6] so that after a short-edge flip
 * each back lands behind its own front. BACK_ORDER is a private constant, so this pins it through the
 * only public seam — buildPrintHtml — by reading the card id printed in each slot.
 */

const pc = (id: string): GameCard =>
  ({ id, cat: 'A', topic: `T${id}`, printBack: `<p>back ${id}</p>` }) as unknown as GameCard;

const payloadOf = (ids: string[]): CardsPayload => ({
  cats: { A: 'CatA' },
  catColors: { A: '#000' },
  cards: ids.map(pc),
  diagrams: {},
  multiPool: {},
});

/** The id in each slot of a `.page`, or 'empty' for an empty slot. Backs carry `.corner`, fronts `.corner-b`. */
function slots(page: Element): string[] {
  return [...page.querySelectorAll('.card')].map((el) => {
    if (el.classList.contains('empty')) return 'empty';
    const corner = el.querySelector('.corner') ?? el.querySelector('.corner-b');
    return corner?.textContent ?? '?';
  });
}

function pages(payload: CardsPayload): Element[] {
  const doc = new DOMParser().parseFromString(buildPrintHtml(payload), 'text/html');
  return [...doc.querySelectorAll('.page')];
}

describe('buildPrintHtml — page layout', () => {
  test('a full page of 8 emits a front page then a back page', () => {
    const p = pages(payloadOf(['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']));
    expect(p.length).toBe(2);
    expect(p[1].classList.contains('back-page')).toBe(true);
  });

  test('12 cards → 4 pages (two 8-card groups, front+back each)', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `C${i}`);
    expect(pages(payloadOf(ids)).length).toBe(4);
  });
});

describe('buildPrintHtml — BACK_ORDER interleave', () => {
  test('fronts print in reading order [0..7]', () => {
    const ids = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    expect(slots(pages(payloadOf(ids))[0])).toEqual(ids);
  });

  test('backs print in swapped order [1,0,3,2,5,4,7,6]', () => {
    const ids = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
    expect(slots(pages(payloadOf(ids))[1])).toEqual(['C1', 'C0', 'C3', 'C2', 'C5', 'C4', 'C7', 'C6']);
  });

  test('a short final group pads with empties, and the swap still holds', () => {
    // 3 cards → g = [C0,C1,C2,empty*5]; BACK_ORDER picks slots [1,0,3,2,5,4,7,6].
    const p = pages(payloadOf(['C0', 'C1', 'C2']));
    expect(slots(p[0])).toEqual(['C0', 'C1', 'C2', 'empty', 'empty', 'empty', 'empty', 'empty']);
    expect(slots(p[1])).toEqual(['C1', 'C0', 'empty', 'C2', 'empty', 'empty', 'empty', 'empty']);
  });

  test('the second group interleaves independently of the first', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `C${i}`); // group 2 = C8..C11
    const p = pages(payloadOf(ids));
    expect(slots(p[3])).toEqual(['C9', 'C8', 'C11', 'C10', 'empty', 'empty', 'empty', 'empty']);
  });
});
