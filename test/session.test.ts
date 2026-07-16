import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { finalize, pickDir } from '../src/client/quiz/session.js';
import { DB } from '../src/client/runtime/db.js';
import { S } from '../src/client/runtime/state.js';
import type { Session } from '../src/client/runtime/state.js';
import type { GameCard } from '../src/shared/card-schema.js';

/**
 * Characterization tests for the two pure-ish decisions in session.ts:
 *   - finalize()'s set-completion bonus, `10 * (2**brackets - 1)` scaled by accuracy, and
 *   - pickDir(), which turns a requested direction + a card's fields into a concrete mode.
 * They pin exactly what these produce today so the refactor cannot quietly change payouts or which
 * mode a card is asked in.
 */

const card = (over: Partial<GameCard> = {}): GameCard => ({
  id: 'A1',
  cat: 'A',
  topic: 'Topic',
  back: '',
  printBack: '',
  backMasked: '',
  cloze: null,
  chars: 40,
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

describe('pickDir — recall short-circuit', () => {
  test('a recall card is always fb, ignoring the requested direction', () => {
    expect(pickDir('mixed', card({ recall: true }))).toBe('fb');
    expect(pickDir('cz', card({ recall: true, cloze: { pre: '', post: '', answer: 'x', alts: [] } }))).toBe(
      'fb',
    );
    expect(pickDir('iv', card({ recall: true, inverse: true }))).toBe('fb');
  });
});

describe('pickDir — an explicit direction is returned verbatim', () => {
  test('non-mixed direction passes through even when the field is absent', () => {
    expect(pickDir('cz', card())).toBe('cz'); // no cloze on the card, still cz
    expect(pickDir('iv', card())).toBe('iv');
    expect(pickDir('bf', card())).toBe('bf');
    expect(pickDir('ma', card({ match: [['a', 'b']] }))).toBe('ma');
  });
});

describe('pickDir — mixed builds a candidate list from the card fields', () => {
  const full = card({
    cloze: { pre: '', post: '', answer: 'x', alts: [] },
    match: [['a', 'b']],
    multi: ['a'],
    inverse: true,
    manifest: { lines: [], blanks: ['x'], distractors: [] },
    code: { lang: 'ts', lines: ['x'] },
    codeselect: { prompt: 'p', answer: [0] },
  });

  afterEach(() => vi.restoreAllMocks());

  test('a bare card offers only fb + bf', () => {
    // m = ['fb','bf']; index = floor(random * 2).
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(pickDir('mixed', card())).toBe('fb');
    vi.spyOn(Math, 'random').mockReturnValue(0.75); // floor(1.5) = 1
    expect(pickDir('mixed', card())).toBe('bf');
  });

  test('a fully-featured card offers all nine modes in field order', () => {
    // m = ['fb','bf','cz','ma','ms','iv','dm','cw','cs'] (length 9).
    const at = (r: number): string => {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      return pickDir('mixed', full);
    };
    expect(at(0)).toBe('fb'); // index 0
    expect(at(0.999)).toBe('cs'); // floor(8.99) = 8, last element
    expect(at(0.5)).toBe('ms'); // floor(4.5) = 4
    expect(at(2 / 9 + 0.01)).toBe('cz'); // index 2
  });

  test('cs joins the list only when the card has BOTH code and codeselect', () => {
    // code but no codeselect → m = ['fb','bf','cw']; cs is absent.
    const c = card({ code: { lang: 'ts', lines: ['x'] } });
    vi.spyOn(Math, 'random').mockReturnValue(0.999); // floor(2.99) = 2 → last element
    expect(pickDir('mixed', c)).toBe('cw');
  });

  test('a cloze-only card offers fb, bf, cz', () => {
    const c = card({ cloze: { pre: '', post: '', answer: 'x', alts: [] } });
    vi.spyOn(Math, 'random').mockReturnValue(0.7); // floor(2.1) = 2
    expect(pickDir('mixed', c)).toBe('cz');
  });
});

describe('finalize — set-completion bonus: round(10 * (2**floor(n/10) - 1) * correct/n)', () => {
  beforeEach(() => {
    DB.coins = 0;
    DB.sessions = [];
    DB.active = null;
  });
  afterEach(() => {
    S.ses = null;
  });

  const makeSes = (n: number, correct: number): Session => ({
    label: 'test',
    q: Array.from({ length: n }, (_, i) => ({ id: `X${i}`, d: 'fb' })),
    i: n,
    correct,
    missed: [],
    elapsedMs: 0,
    notes: {},
    timeSpeed: 0,
  });

  // [totalCards, correct, expectedBonus]. undefined bonus = setBonus never set, coins untouched.
  const CASES: [number, number, number | undefined][] = [
    [10, 10, 10], // brackets=1, base=10
    [10, 5, 5],
    [10, 0, undefined], // bonus rounds to 0 → skipped
    [9, 9, undefined], // brackets=0 → no bonus at all
    [20, 20, 30], // brackets=2, base=30
    [20, 10, 15],
    [25, 25, 30], // floor(25/10)=2 → base 30
    [25, 13, 16], // round(30 * 13/25) = round(15.6)
    [30, 30, 70], // brackets=3, base=70
    [30, 15, 35],
    [40, 40, 150], // brackets=4, base=150
  ];

  test.each(CASES)('n=%i correct=%i → bonus %s', (n, correct, expected) => {
    DB.coins = 0;
    S.ses = makeSes(n, correct);
    finalize();
    if (expected === undefined) {
      expect(S.ses!.setBonus).toBeUndefined();
      expect(DB.coins).toBe(0);
    } else {
      expect(S.ses!.setBonus).toBe(expected);
      expect(S.ses!.coins).toBe(expected);
      expect(DB.coins).toBe(expected);
    }
  });

  test('finalize is idempotent — a second call adds no further bonus', () => {
    DB.coins = 0;
    S.ses = makeSes(10, 10);
    finalize();
    finalize();
    expect(DB.coins).toBe(10);
  });
});
