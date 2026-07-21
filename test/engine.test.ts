import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderQ } from '../src/client/quiz/engine.js';
import { stopTicker } from '../src/client/quiz/timer.js';
import { app, initData } from '../src/client/runtime/data.js';
import { DB } from '../src/client/runtime/db.js';
import { S } from '../src/client/runtime/state.js';
import type { CardsPayload, GameCard } from '../src/shared/card-schema.js';

// setup.ts stubs the Web Audio sound module, but its mock predates any test that drove renderQ, so it
// omits sndFlip (which renderQ calls on every card). Re-mock the module for this file WITH sndFlip.
vi.mock('../src/client/audio/sound.js', () => ({
  audioInit: vi.fn(),
  setVolume: vi.fn(),
  sndFlip: vi.fn(),
  sndCorrect: vi.fn(),
  sndWrong: vi.fn(),
  sndCoin: vi.fn(),
  sndClick: vi.fn(),
  sndPlace: vi.fn(),
}));

/**
 * Characterization tests for renderQ()'s mode-fallback chain: when a card is asked in a mode it lacks
 * the fields for (e.g. cz on a card with no cloze), renderQ downgrades to a mode the card can support.
 * renderQ is not easily called with a return value, so — following modes.test.ts — we observe the
 * RESOLVED mode through the public seam it always renders: the `.dir` label each mode prints. The
 * label→mode map is the one modes.test.ts already pins.
 */

const DIR: Record<string, string> = {
  fb: 'recall',
  bf: 'identify',
  cz: 'fill in',
  ma: 'match',
  ms: 'select all',
  iv: 'name it',
  dm: 'label the YAML',
  cw: 'read the code',
  cs: 'select lines',
};

const card = (over: Partial<GameCard> = {}): GameCard => ({
  id: 'A1',
  cat: 'A',
  topic: 'Load balancer',
  back: '<p>Spreads traffic across servers.</p>',
  printBack: '<p>Spreads traffic across servers.</p>',
  backMasked: '<p>Spreads traffic across [___].</p>',
  cloze: null,
  chars: 40,
  hint: '',
  match: null,
  multi: null,
  mc: null,
  recall: false,
  inverse: false,
  manifest: null,
  order: null,
  code: null,
  codeselect: null,
  ...over,
});

const CLOZE = { pre: 'Splitting a dataset across nodes is ', post: '.', answer: 'sharding', alts: ['x'] };
const MATCH: [string, string][] = [
  ['LB', 'spreads'],
  ['CDN', 'caches'],
];
const MANIFEST = { lines: ['kind: {0}'], blanks: ['Deployment'], distractors: ['Service'] };
const CODE = { lang: 'dockerfile', lines: ['FROM node', 'RUN x', 'CMD y'] };
const CODESELECT = { prompt: 'select', answer: [1] };

// Cards exercising each fallback branch, plus filler so renderBF/renderCW have a distractor pool.
const CARDS: GameCard[] = [
  card({ id: 'NO_CLOZE', cloze: null }),
  card({ id: 'HAS_CLOZE', cloze: CLOZE }),
  card({ id: 'NO_MATCH', match: null }),
  card({ id: 'HAS_MATCH', match: MATCH }),
  card({ id: 'NO_MULTI', multi: null }),
  card({ id: 'HAS_MULTI', multi: ['a', 'b'] }),
  card({ id: 'NO_INV', inverse: false }),
  card({ id: 'HAS_INV', inverse: true }),
  card({ id: 'DM_NO_MAN_MATCH', manifest: null, match: MATCH }),
  card({ id: 'DM_NO_MAN_NO_MATCH', manifest: null, match: null }),
  card({ id: 'HAS_MAN', manifest: MANIFEST }),
  card({ id: 'NO_CODE', code: null }),
  card({ id: 'CS_NO_CODE', code: null, codeselect: null }),
  card({ id: 'CS_CODE_NO_SEL', code: CODE, codeselect: null }),
  card({ id: 'CS_BOTH', code: CODE, codeselect: CODESELECT }),
  card({ id: 'PLAIN', topic: 'Consistent hashing' }),
  card({ id: 'F1', topic: 'Circuit breaker' }),
  card({ id: 'F2', topic: 'Message queue' }),
  card({ id: 'F3', topic: 'Rate limiter' }),
  card({ id: 'F4', topic: 'Bloom filter' }),
];

const PAYLOAD: CardsPayload = {
  cats: { A: 'Scalability & System Design' },
  catColors: { A: '#5a67f2' },
  cards: CARDS,
  diagrams: {},
  multiPool: {},
};

/** Ask `cardId` in `mode` and report which mode actually rendered, via its `.dir` label. */
function resolvedMode(cardId: string, mode: string): string {
  S.ses = {
    label: 'test',
    q: [{ id: cardId, d: mode }],
    i: 0,
    correct: 0,
    missed: [],
    elapsedMs: 0,
    notes: {},
    timeSpeed: 0,
  };
  S.curLimit = 0;
  renderQ();
  const dir = app.querySelector('.dir')?.textContent ?? '';
  const hit = Object.entries(DIR).find(([, label]) => label === dir);
  return hit ? hit[0] : `?(${dir})`;
}

beforeEach(() => {
  initData(PAYLOAD);
  DB.coins = 0;
  DB.combo = 0;
  DB.stats = {};
});
afterEach(() => {
  stopTicker();
  S.ses = null;
});

describe('renderQ — mode-fallback chain', () => {
  // [requested mode, card id, expected resolved mode]
  const CASES: [string, string, string][] = [
    ['cz', 'NO_CLOZE', 'fb'], // cz without cloze → fb
    ['cz', 'HAS_CLOZE', 'cz'], // cz kept
    ['ma', 'NO_MATCH', 'bf'], // ma without match → bf
    ['ma', 'HAS_MATCH', 'ma'], // ma kept
    ['ms', 'NO_MULTI', 'bf'], // ms without multi → bf
    ['iv', 'NO_INV', 'fb'], // iv without inverse → fb
    ['iv', 'HAS_INV', 'iv'], // iv kept
    ['dm', 'DM_NO_MAN_MATCH', 'ma'], // dm without manifest but with match → ma
    ['dm', 'DM_NO_MAN_NO_MATCH', 'bf'], // dm without manifest, no match → bf
    ['dm', 'HAS_MAN', 'dm'], // dm kept
    ['cw', 'NO_CODE', 'bf'], // cw without code → bf
    ['cs', 'CS_NO_CODE', 'bf'], // cs without code → bf
    ['cs', 'CS_CODE_NO_SEL', 'cw'], // cs with code but no codeselect → cw
    ['cs', 'CS_BOTH', 'cs'], // cs kept
  ];

  test.each(CASES)('%s on %s resolves to %s', (mode, id, expected) => {
    expect(resolvedMode(id, mode)).toBe(expected);
  });
});

describe('renderQ — modes that already match pass through unchanged', () => {
  test.each([
    ['fb', 'PLAIN'],
    ['bf', 'PLAIN'],
    ['ms', 'HAS_MULTI'],
  ] as [string, string][])('%s stays %s', (mode, id) => {
    expect(resolvedMode(id, mode)).toBe(mode);
  });
});
