import { describe, expect, test } from 'vitest';
import type { GameCard } from '../../shared/card-schema.js';
import { baseSeconds } from './timer.js';

/**
 * Characterization tests for baseSeconds() — the content-aware per-mode timer budget. It is a wall
 * of magic numbers (per-mode cps rates, floors, and caps), so these pin the EXACT seconds it returns
 * today for a table of representative (card, mode) inputs. The upcoming refactor must not move any of
 * these numbers: the timer is what makes a fast card feel fair and a dense card survivable.
 *
 * String lengths are built with .repeat() so the arithmetic behind each expected value is visible.
 */

const card = (over: Partial<GameCard> = {}): GameCard => ({
  id: 'T1',
  cat: 'A',
  topic: 'Topic',
  back: '<p>answer</p>',
  printBack: '<p>answer</p>',
  backMasked: '<p>answer</p>',
  cloze: null,
  chars: 200,
  hint: '',
  match: null,
  multi: null,
  mc: null,
  recall: false,
  inverse: false,
  manifest: null,
  code: null,
  codeselect: null,
  ...over,
});

const pairs = (n: number): [string, string][] =>
  Array.from({ length: n }, (_, i) => [`l${i}`, `r${i}`] as [string, string]);

describe('baseSeconds — ma (match): max(20, min(5, pairs||4) * 8)', () => {
  test('2 pairs → 20 (floor wins over 16)', () => {
    expect(baseSeconds(card({ match: pairs(2) }), 'ma')).toBe(20);
  });
  test('3 pairs → 24', () => {
    expect(baseSeconds(card({ match: pairs(3) }), 'ma')).toBe(24);
  });
  test('5 pairs → 40', () => {
    expect(baseSeconds(card({ match: pairs(5) }), 'ma')).toBe(40);
  });
  test('6 pairs is capped at 5 → 40', () => {
    expect(baseSeconds(card({ match: pairs(6) }), 'ma')).toBe(40);
  });
  test('no match → defaults n=4 → 32', () => {
    expect(baseSeconds(card({ match: null }), 'ma')).toBe(32);
  });
  test('empty match array → 0 || 4 = 4 → 32', () => {
    expect(baseSeconds(card({ match: [] }), 'ma')).toBe(32);
  });
});

describe('baseSeconds — dm (label the YAML): max(24, blanks * 9)', () => {
  const withBlanks = (n: number): GameCard =>
    card({ manifest: { lines: [], blanks: Array(n).fill('x'), distractors: [] } });
  test('2 blanks → 24 (floor wins over 18)', () => {
    expect(baseSeconds(withBlanks(2), 'dm')).toBe(24);
  });
  test('3 blanks → 27', () => {
    expect(baseSeconds(withBlanks(3), 'dm')).toBe(27);
  });
  test('5 blanks → 45', () => {
    expect(baseSeconds(withBlanks(5), 'dm')).toBe(45);
  });
  test('no manifest → defaults n=4 → 36', () => {
    expect(baseSeconds(card({ manifest: null }), 'dm')).toBe(36);
  });
});

describe('baseSeconds — flat-rate modes', () => {
  test('ms → 30', () => {
    expect(baseSeconds(card(), 'ms')).toBe(30);
  });
  test('iv → 18', () => {
    expect(baseSeconds(card(), 'iv')).toBe(18);
  });
});

describe('baseSeconds — cw (read the code): max(20, lines * 3 + 12)', () => {
  const withLines = (n: number): GameCard =>
    card({ code: { lang: 'ts', lines: Array(n).fill('x') } });
  test('1 line → 15 clamped to 20', () => {
    expect(baseSeconds(withLines(1), 'cw')).toBe(20);
  });
  test('3 lines → 21', () => {
    expect(baseSeconds(withLines(3), 'cw')).toBe(21);
  });
  test('4 lines → 24', () => {
    expect(baseSeconds(withLines(4), 'cw')).toBe(24);
  });
  test('no code → defaults 6 lines → 30', () => {
    expect(baseSeconds(card({ code: null }), 'cw')).toBe(30);
  });
});

describe('baseSeconds — cs (select lines): max(26, lines * 4 + 12)', () => {
  const withLines = (n: number): GameCard =>
    card({ code: { lang: 'ts', lines: Array(n).fill('x') } });
  test('3 lines → 24 clamped to 26', () => {
    expect(baseSeconds(withLines(3), 'cs')).toBe(26);
  });
  test('4 lines → 28', () => {
    expect(baseSeconds(withLines(4), 'cs')).toBe(28);
  });
  test('no code → defaults 6 lines → 36', () => {
    expect(baseSeconds(card({ code: null }), 'cs')).toBe(36);
  });
});

describe('baseSeconds — char-budget modes: max(6, chars / cps)', () => {
  // cps: fb → 11, cz → 8, everything else → 22.
  test('fb: chars=88 → 88/11 = 8', () => {
    expect(baseSeconds(card({ chars: 88 }), 'fb')).toBe(8);
  });
  test('fb: short content clamps to the 6s floor (chars=11 → 1 → 6)', () => {
    expect(baseSeconds(card({ chars: 11 }), 'fb')).toBe(6);
  });
  test('fb: chars falsy → falls back to 200 → 200/11', () => {
    expect(baseSeconds(card({ chars: 0 }), 'fb')).toBeCloseTo(18.1818, 4);
  });
  test('cz WITH cloze: uses pre+post+answer length / 8', () => {
    const cloze = { pre: 'a'.repeat(80), post: 'b'.repeat(8), answer: 'c'.repeat(8), alts: [] };
    // 80 + 8 + 8 = 96 chars, 96/8 = 12.
    expect(baseSeconds(card({ cloze }), 'cz')).toBe(12);
  });
  test('cz WITHOUT cloze: uses card.chars / 8 (chars=80 → 10)', () => {
    expect(baseSeconds(card({ chars: 80, cloze: null }), 'cz')).toBe(10);
  });
  test('bf (other): cps=22 (chars=220 → 10)', () => {
    expect(baseSeconds(card({ chars: 220 }), 'bf')).toBe(10);
  });
  test('unknown mode: cps=22 (chars=440 → 20)', () => {
    expect(baseSeconds(card({ chars: 440 }), 'zz')).toBe(20);
  });
});
